import { describe, expect, it, vi } from "vitest";

import { createReactionRoleHandler } from "../src/features/reaction-roles/handler.js";

describe("reaction role handler", () => {
  it("adds a role when a matching reaction is added", async () => {
    const addRole = vi.fn(async () => undefined);
    const removeRole = vi.fn(async () => undefined);
    const handler = createReactionRoleHandler({
      findRule: () => ({
        messageId: "message-1",
        emoji: "🔥",
        roleId: "role-fire",
      }),
      withMemberRoleManager: async (_guildId, _userId, run) =>
        run({ add: addRole, remove: removeRole }),
    });

    await handler.onReactionAdd({
      messageId: "message-1",
      guildId: "guild-1",
      userId: "user-1",
      emoji: { name: "🔥", id: null },
    });

    expect(addRole).toHaveBeenCalledWith("role-fire");
    expect(removeRole).not.toHaveBeenCalled();
  });

  it("removes a role when a matching reaction is removed", async () => {
    const addRole = vi.fn(async () => undefined);
    const removeRole = vi.fn(async () => undefined);
    const handler = createReactionRoleHandler({
      findRule: () => ({
        messageId: "message-1",
        emoji: "🔥",
        roleId: "role-fire",
      }),
      withMemberRoleManager: async (_guildId, _userId, run) =>
        run({ add: addRole, remove: removeRole }),
    });

    await handler.onReactionRemove({
      messageId: "message-1",
      guildId: "guild-1",
      userId: "user-1",
      emoji: { name: "🔥", id: null },
    });

    expect(removeRole).toHaveBeenCalledWith("role-fire");
    expect(addRole).not.toHaveBeenCalled();
  });

  it("ignores reactions with no configured rule", async () => {
    const withMemberRoleManager = vi.fn();
    const handler = createReactionRoleHandler({
      findRule: () => null,
      withMemberRoleManager,
    });

    await handler.onReactionAdd({
      messageId: "message-1",
      guildId: "guild-1",
      userId: "user-1",
      emoji: { name: "🔥", id: null },
    });

    expect(withMemberRoleManager).not.toHaveBeenCalled();
  });
});
