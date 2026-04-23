export interface AccountConfig {
  id: string;
  tiktokHandle: string;
  youtubeChannel: string;
  niche: string;
  sessionFile: string;
  topics: {
    subreddits: string[];
    keywords: string[];
    affiliateLinks: Record<string, string>;
  };
  promptStyle: string;
}

export const mindshield: AccountConfig = {
  id: 'mindshield',
  tiktokHandle: '@MindShieldDaily',
  youtubeChannel: 'MindShieldDaily',
  niche: 'Dark Psychology',
  sessionFile: 'assets/sessions/mindshield-tiktok.json',
  topics: {
    subreddits: [
      'psychology',
      'socialskills',
      'NarcissisticAbuse',
      'manipulation',
      'darkpsychology',
      'behavioraleconomics',
      'relationship_advice',
    ],
    keywords: [
      'manipulation', 'psychology', 'narcissist',
      'gaslighting', 'dark triad', 'persuasion',
      'body language', 'mind control', 'influence',
      'cognitive bias', 'trauma bond', 'love bombing',
    ],
    affiliateLinks: {},
  },
  promptStyle: `
    Mysterious, eye-opening, documentary narrator tone.
    ALWAYS frame from DEFENSIVE angle:
    "how to recognize or protect yourself from X"
    NEVER instruct how to manipulate others.
    Use phrases like: "most people don't know this",
    "they don't want you to know", "recognize this pattern",
    "protect yourself before it is too late"
  `.trim(),
};

export const ACTIVE_ACCOUNT: AccountConfig = mindshield;
