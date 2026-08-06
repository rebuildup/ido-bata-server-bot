import { existsSync } from "node:fs";

import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import type { Client, GuildMember, VoiceBasedChannel } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Events,
} from "discord.js";

import {
  isTimekeeperConfigured,
  timekeeperConfig,
  type TimekeeperConfig,
} from "./config.js";
import {
  buildCheckInCustomId,
  buildCheckInLabel,
  buildFortuneSummary,
  createSessionEngagement,
  getSessionCheckInCount,
  parseCheckInCustomId,
  persistSessionAttendance,
  recordCheckIn,
  type TimekeeperSessionEngagement,
} from "./engagement.js";
import { getCurrentOrNextDailyStartAt } from "./schedule.js";
import {
  buildProgressMessage,
  buildTimekeeperTimeline,
  type TimekeeperTimelineEvent,
} from "./timeline.js";
import { attachVoiceDebugging, logVoiceStateSnapshot } from "./voice-debug.js";

type EditableTextMessage = {
  edit: (content: string | { components?: unknown[]; content: string }) => Promise<unknown>;
};

type SendableTextChannel = {
  send: (
    content: string | { components?: unknown[]; content: string },
  ) => Promise<EditableTextMessage>;
};

type SessionClock = {
  isMidSession: boolean;
  minuteMs: number;
  runBase: number;
  timelineBase: number;
};

let activeSession: TimekeeperSessionEngagement | null = null;
let activeTimeline: TimekeeperTimelineEvent[] = [];

export function registerTimekeeper(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) {
      return;
    }

    const parsed = parseCheckInCustomId(interaction.customId);
    if (!parsed || !activeSession || parsed.sessionId !== activeSession.id) {
      return;
    }

    const recorded = recordCheckIn(activeSession, interaction.user.id, parsed.order);
    const event = activeTimeline.find((entry) => entry.order === parsed.order);

    if (event) {
      const updatedContent = buildProgressMessage(
        event,
        clampNowToEvent(event),
        getSessionCheckInCount(activeSession, event.order),
      );

      if (updatedContent) {
        await interaction.update({
          content: updatedContent,
          components: buildCheckInComponents(event),
        });
        return;
      }
    }

    await interaction.reply({
      content: recorded ? "確認を受け付けました。" : "このフェーズの確認はすでに済んでいます。",
      ephemeral: true,
    });
  });

  client.once(Events.ClientReady, () => {
    if (process.env.TIMEKEEPER_RUN_ON_READY === "true") {
      const now = new Date();
      const sessionStartAt = getCurrentOrNextDailyStartAt(
        now,
        timekeeperConfig.startHourJst,
        timekeeperConfig.startMinuteJst,
        timekeeperConfig.phases,
      );
      const startAt = isWithinSessionWindow(now, sessionStartAt, timekeeperConfig)
        ? sessionStartAt
        : now;

      console.log(`Running timekeeper immediately because TIMEKEEPER_RUN_ON_READY=true (startAt=${startAt.toISOString()})`);
      void runSession(client, timekeeperConfig, startAt).catch((error: unknown) => {
        console.error("Immediate timekeeper session failed", error);
      });
      return;
    }

    scheduleNextSession(client, timekeeperConfig);
  });
}

function scheduleNextSession(client: Client, config: TimekeeperConfig): void {
  if (!isTimekeeperConfigured(config)) {
    console.warn("Timekeeper is disabled. Set voiceChannelId and textChannelId in timekeeper config.");
    return;
  }

  const nextStartAt = getCurrentOrNextDailyStartAt(
    new Date(),
    config.startHourJst,
    config.startMinuteJst,
    config.phases,
  );
  const preparationStartAt = new Date(nextStartAt.getTime() - 60_000);
  const delayMs = Math.max(0, preparationStartAt.getTime() - Date.now());

  console.log(`Next timekeeper session scheduled for ${nextStartAt.toISOString()} (preparation starts at ${preparationStartAt.toISOString()})`);

  setTimeout(() => {
    void runSession(client, config, nextStartAt)
      .catch((error: unknown) => {
        console.error("Timekeeper session failed", error);
      })
      .finally(() => {
        scheduleNextSession(client, config);
      });
  }, delayMs);
}

function isWithinSessionWindow(
  now: Date,
  startAt: Date,
  config: TimekeeperConfig,
): boolean {
  const totalDurationMinutes = config.phases.reduce(
    (total, phase) => total + phase.durationMinutes,
    0,
  );
  const sessionEndAt = new Date(startAt.getTime() + totalDurationMinutes * 60_000);
  return now >= startAt && now < sessionEndAt;
}

async function runSession(
  client: Client,
  config: TimekeeperConfig,
  startAt: Date,
): Promise<void> {
  const voiceChannel = await resolveVoiceChannel(client, config.voiceChannelId);
  const textChannel = await resolveTextChannel(client, config.textChannelId);

  if (!voiceChannel) {
    throw new Error(`Voice channel not found: ${config.voiceChannelId}`);
  }

  if (!textChannel) {
    throw new Error(`Text channel not found: ${config.textChannelId}`);
  }

  const connection = await connectForPlayback(voiceChannel, client);

  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Pause,
    },
  });

  attachVoiceDebugging(connection, player);
  connection.subscribe(player);

  const timeline = buildTimekeeperTimeline(startAt, config);
  const now = new Date();

  let startIndex = 0;
  for (let i = 0; i < timeline.length; i += 1) {
    const event = timeline[i];
    const eventEnd = event.endAt ?? new Date(event.at.getTime() + 60_000);
    if (now < eventEnd) {
      startIndex = i;
      if (event.at > now) {
        console.log(`[Timekeeper] Starting from upcoming phase: ${event.label} (at ${event.at.toISOString()})`);
      } else {
        console.log(`[Timekeeper] Resuming from current phase: ${event.label} (started at ${event.at.toISOString()})`);
      }
      break;
    }
  }

  activeTimeline = timeline;
  activeSession = createSessionEngagement(startAt.toISOString());

  if (startIndex > 0) {
    await postMissedProgressMessages(textChannel, timeline, startIndex, now);
  }

  const clock = createSessionClock(timeline, startAt, startIndex);
  const progressTasks: Promise<void>[] = [];

  const eventsToRun = startIndex > 0 ? timeline.slice(startIndex) : timeline;
  for (const event of eventsToRun) {
    const waitMs = getDelayFor(clock, event.at);
    if (waitMs > 0) {
      await delay(waitMs);
    }

    if (!existsSync(event.audioPath)) {
      throw new Error(`Audio file not found: ${event.audioPath}`);
    }

    const progressTask = await playAnnouncement(
      connection,
      client,
      voiceChannel,
      player,
      textChannel,
      event,
      clock,
    );

    if (progressTask) {
      progressTasks.push(progressTask);
    }
  }

  await Promise.allSettled(progressTasks);
  if (activeSession) {
    persistSessionAttendance(activeSession, formatSessionDate(startAt));
  }
  const fortuneSummaries = activeSession ? await buildFortuneSummary(activeSession) : null;
  if (fortuneSummaries) {
    for (const summary of fortuneSummaries) {
      await textChannel.send(summary);
    }
  }
  activeSession = null;
  activeTimeline = [];
  connection.destroy();
}

async function playAnnouncement(
  connection: Awaited<ReturnType<typeof connectForPlayback>>,
  client: Client,
  voiceChannel: VoiceBasedChannel,
  player: ReturnType<typeof createAudioPlayer>,
  textChannel: SendableTextChannel,
  event: TimekeeperTimelineEvent,
  clock: SessionClock,
): Promise<Promise<void> | null> {
  await refreshStageSpeakerBeforePlayback(client, voiceChannel);
  connection.setSpeaking(true);
  await delay(250);

  let progressTask: Promise<void> | null = null;
  const messageNow = clampNowToEvent(event);
  const initialMessage = buildProgressMessage(
    event,
    messageNow,
    activeSession ? getSessionCheckInCount(activeSession, event.order) : 0,
  );
  if (initialMessage) {
    const sentMessage = await textChannel.send({
      content: initialMessage,
      components: buildCheckInComponents(event),
    });
    progressTask = updateProgressMessage(sentMessage, event, clock);
  }

  console.log(`[Timekeeper] Playing: ${event.audioPath} (order=${event.order})`);
  const resource = createAudioResource(event.audioPath);
  player.play(resource);
  
  try {
    await entersState(player, AudioPlayerStatus.Playing, 30_000);
    console.log(`[Timekeeper] Playing state reached: order=${event.order}`);
  } catch {
    console.error(`[Timekeeper] Failed to reach Playing state: order=${event.order}, status=${player.state.status}`);
  }
  
  try {
    await entersState(player, AudioPlayerStatus.Idle, 60_000);
    console.log(`[Timekeeper] Idle state reached: order=${event.order}`);
  } catch {
    console.error(`[Timekeeper] Failed to reach Idle state: order=${event.order}, status=${player.state.status}`);
  }
  
  connection.setSpeaking(false);
  return progressTask;
}

async function resolveVoiceChannel(
  client: Client,
  channelId: string,
): Promise<VoiceBasedChannel | null> {
  const channel = await client.channels.fetch(channelId);

  if (!channel?.isVoiceBased()) {
    return null;
  }

  return channel;
}

async function prepareStageSpeaker(
  voiceChannel: VoiceBasedChannel,
  client: Client,
): Promise<void> {
  if (voiceChannel.type !== ChannelType.GuildStageVoice) {
    return;
  }

  if (!client.user) {
    throw new Error("Bot user is not ready");
  }

  const botMember = await resolveBotMember(voiceChannel.guild, client.user.id);

  if (!botMember) {
    throw new Error("Bot member not found in guild");
  }

  try {
    await botMember.voice.setSuppressed(false);
    console.log("Stage speaker mode enabled by unsuppressing the bot.");
  } catch (error) {
    console.warn("Failed to unsuppress bot in stage channel. Requesting to speak instead.", error);
    await botMember.voice.setRequestToSpeak(true).catch(() => undefined);
    await delay(2_000);
  }

  await delay(1_000);
  await logVoiceStateSnapshot(botMember, voiceChannel, "after-stage-prepare");
}

async function connectForPlayback(
  voiceChannel: VoiceBasedChannel,
  client: Client,
) {
  let connection = await joinAndPrepare(voiceChannel, client);

  if (voiceChannel.type !== ChannelType.GuildStageVoice) {
    return connection;
  }

  // Stage channels can fail to relay audio immediately after the first join.
  // Reconnecting after unsuppressing the bot is a practical workaround.
  console.log("Reconnecting stage channel once before playback.");
  connection.destroy();
  await delay(1_500);

  connection = await joinAndPrepare(voiceChannel, client);
  return connection;
}

async function joinAndPrepare(
  voiceChannel: VoiceBasedChannel,
  client: Client,
) {
  const connection = joinVoiceChannel({
    guildId: voiceChannel.guild.id,
    channelId: voiceChannel.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  await prepareStageSpeaker(voiceChannel, client);
  await delay(1_000);

  if (client.user) {
    const botMember = await resolveBotMember(voiceChannel.guild, client.user.id);
    if (botMember) {
      await logVoiceStateSnapshot(botMember, voiceChannel, "after-join");
    }
  }

  return connection;
}

async function resolveTextChannel(
  client: Client,
  channelId: string,
): Promise<SendableTextChannel | null> {
  const channel = await client.channels.fetch(channelId);

  if (!channel || channel.type === ChannelType.GuildCategory) {
    return null;
  }

  if (!channel.isTextBased() || !("send" in channel)) {
    return null;
  }

  return channel as SendableTextChannel;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createSessionClock(
  timeline: TimekeeperTimelineEvent[],
  startAt: Date,
  startIndex: number,
): SessionClock {
  const isRunningMidSession = startIndex > 0;
  const midSessionBase = timeline[startIndex]?.at.getTime() ?? startAt.getTime();
  return {
    isMidSession: isRunningMidSession,
    minuteMs: process.env.TIMEKEEPER_RUN_ON_READY === "true" ? 1_000 : 60_000,
    timelineBase: isRunningMidSession ? midSessionBase : startAt.getTime(),
    runBase: isRunningMidSession ? Date.now() : startAt.getTime(),
  };
}

function getDelayFor(clock: SessionClock, targetAt: Date): number {
  if (clock.isMidSession && process.env.TIMEKEEPER_RUN_ON_READY !== "true") {
    return targetAt.getTime() - Date.now();
  }

  const minutesFromBase = (targetAt.getTime() - clock.timelineBase) / 60_000;
  const runtimeAt = clock.runBase + minutesFromBase * clock.minuteMs;
  return runtimeAt - Date.now();
}

async function resolveBotMember(
  guild: VoiceBasedChannel["guild"],
  userId: string,
): Promise<GuildMember | null> {
  return guild.members.fetch(userId).catch(() => null);
}

async function refreshStageSpeakerBeforePlayback(
  client: Client,
  voiceChannel: VoiceBasedChannel,
): Promise<void> {
  if (voiceChannel.type !== ChannelType.GuildStageVoice || !client.user) {
    return;
  }

  const botMember = await resolveBotMember(voiceChannel.guild, client.user.id);

  if (!botMember) {
    return;
  }

  try {
    await botMember.voice.setSuppressed(false);
  } catch {
    console.log("Failed to unsuppress, requesting to speak...");
    await botMember.voice.setRequestToSpeak(true).catch(() => undefined);
    await delay(2_000);
  }

  await delay(500);
  await logVoiceStateSnapshot(botMember, voiceChannel, "before-playback");
}

async function updateProgressMessage(
  message: EditableTextMessage,
  event: TimekeeperTimelineEvent,
  clock: SessionClock,
): Promise<void> {
  if (!event.durationMinutes) {
    return;
  }

  const now = clampNowToEvent(event);
  const elapsedMinutes = getElapsedWholeMinutes(event, now);

  for (let minute = elapsedMinutes + 1; minute <= event.durationMinutes; minute += 1) {
    const targetAt = new Date(event.at.getTime() + minute * 60_000);
    const waitMs = getDelayFor(clock, targetAt);
    if (waitMs > 0) {
      await delay(waitMs);
    }

    const nextMessage = buildProgressMessage(
      event,
      targetAt,
      activeSession ? getSessionCheckInCount(activeSession, event.order) : 0,
    );
    if (!nextMessage) {
      return;
    }

    await message.edit({
      content: nextMessage,
      components: minute === event.durationMinutes ? [] : buildCheckInComponents(event),
    });
  }
}

function buildCheckInComponents(event: TimekeeperTimelineEvent): ActionRowBuilder<ButtonBuilder>[] {
  if (!event.sendText || !activeSession) {
    return [];
  }

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCheckInCustomId(activeSession.id, event.order))
        .setLabel(`${buildCheckInLabel(event.kind)} (${getSessionCheckInCount(activeSession, event.order)})`)
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function formatSessionDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function clampNowToEvent(event: TimekeeperTimelineEvent): Date {
  if (!event.endAt) {
    return event.at;
  }

  const now = new Date();
  if (now < event.at) {
    return event.at;
  }

  if (now > event.endAt) {
    return event.endAt;
  }

  return now;
}

function getElapsedWholeMinutes(event: TimekeeperTimelineEvent, now: Date): number {
  const elapsedMs = Math.max(0, now.getTime() - event.at.getTime());
  return Math.floor(elapsedMs / 60_000);
}

async function postMissedProgressMessages(
  textChannel: SendableTextChannel,
  timeline: TimekeeperTimelineEvent[],
  startIndex: number,
  now: Date,
): Promise<void> {
  const missedTextEvents = timeline
    .slice(0, startIndex)
    .filter((event) => event.sendText);

  for (const event of missedTextEvents) {
    const effectiveNow = clampTimeToEvent(event, now);
    const content = buildProgressMessage(
      event,
      effectiveNow,
      activeSession ? getSessionCheckInCount(activeSession, event.order) : 0,
    );
    if (!content) {
      continue;
    }

    await textChannel.send({
      content,
      components: effectiveNow < (event.endAt ?? event.at) ? buildCheckInComponents(event) : [],
    });
  }
}

function clampTimeToEvent(event: TimekeeperTimelineEvent, time: Date): Date {
  if (!event.endAt) {
    return event.at;
  }

  if (time < event.at) {
    return event.at;
  }

  if (time > event.endAt) {
    return event.endAt;
  }

  return time;
}
