export interface SeriesConfig {
  id: string;
  name: string;
  description: string;
  episodePrefix: string;
  pillar: string;
  targetEpisodes: number;
}

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
  series: SeriesConfig[];
}

export const mindshield: AccountConfig = {
  id: 'mindshield',
  tiktokHandle: '@mindshieldaily',
  youtubeChannel: 'Mind Shield Daily',
  niche: 'Dark Psychology',
  sessionFile: 'assets/sessions/mindshield-tiktok.json',
  topics: {
    subreddits: [
      'psychology',           // cognitive bias, general
      'socialskills',         // body language, social engineering
      'NarcissisticAbuse',    // manipulation, toxic relationships
      'manipulation',         // manipulation tactics
      'darkpsychology',       // all pillars
      'behavioraleconomics',  // cognitive biases
      'relationship_advice',  // manipulation, self mastery
      'cults',                // cult psychology
      'Scams',                // social engineering
      'poweruserofreddit',    // power dynamics
      'Stoicism',             // self mastery
      'bodylanguage',         // body language
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
  series: [
    {
      id: 'manipulation_exposed',
      name: 'Manipulation Exposed',
      description: 'One manipulation tactic per video',
      episodePrefix: 'Manipulation Exposed',
      pillar: 'manipulation',
      targetEpisodes: 30,
    },
    {
      id: 'read_anyone',
      name: 'Read Anyone',
      description: 'Body language secrets',
      episodePrefix: 'Read Anyone',
      pillar: 'body_language',
      targetEpisodes: 20,
    },
    {
      id: 'bias_of_the_day',
      name: 'Bias of the Day',
      description: 'One cognitive bias explained',
      episodePrefix: 'Bias of the Day',
      pillar: 'cognitive_bias',
      targetEpisodes: 25,
    },
    {
      id: '48_laws',
      name: '48 Laws Explained',
      description: 'One law of power per video',
      episodePrefix: '48 Laws',
      pillar: 'power',
      targetEpisodes: 48,
    },
    {
      id: 'dark_psych_101',
      name: 'Dark Psychology 101',
      description: 'Beginner dark psychology concepts',
      episodePrefix: 'Dark Psych 101',
      pillar: 'manipulation',
      targetEpisodes: 30,
    },
  ],
};

export const ACTIVE_ACCOUNT: AccountConfig = mindshield;
