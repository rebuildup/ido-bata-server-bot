export type EmojiLike = {
  id: string | null;
  name: string | null;
};

export type ReactionRoleRule = {
  messageId: string;
  emoji: string;
  roleId: string;
};

// Replace these placeholder values with your actual Discord IDs.
export const reactionRoleRules: ReactionRoleRule[] = [
  {
    messageId: "1481188592448438355",
    emoji: "🔥",
    roleId: "1326148759150788691",
  },
];

export function toEmojiKey(emoji: EmojiLike): string | null {
  if (emoji.id) {
    return emoji.id;
  }

  return emoji.name;
}

export function findReactionRoleRule(messageId: string, emoji: EmojiLike): ReactionRoleRule | null {
  const emojiKey = toEmojiKey(emoji);

  if (!emojiKey) {
    return null;
  }

  return (
    reactionRoleRules.find((rule) => rule.messageId === messageId && rule.emoji === emojiKey) ??
    null
  );
}
