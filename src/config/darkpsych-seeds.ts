export type Pillar =
  | 'manipulation'
  | 'cognitive_bias'
  | 'body_language'
  | 'power'
  | 'cult'
  | 'social_engineering'
  | 'self_mastery';

export const ALL_PILLARS: Pillar[] = [
  'manipulation',
  'cognitive_bias',
  'body_language',
  'power',
  'cult',
  'social_engineering',
  'self_mastery',
];

export interface SeedTopic {
  title: string;
  hook: string;
  target_emotion: 'shock' | 'curiosity' | 'fomo' | 'greed' | 'satisfaction';
  pillar: Pillar;
}

export const darkPsychSeeds: SeedTopic[] = [
  // ━━━ PILLAR 1: MANIPULATION TACTICS ━━━
  { title: 'DARVO — how abusers flip the script', hook: 'You confronted them. Somehow you ended up apologizing.', target_emotion: 'shock', pillar: 'manipulation' },
  { title: 'Future Faking — promises they never intend to keep', hook: 'They painted a perfect future. They were never going to take you there.', target_emotion: 'shock', pillar: 'manipulation' },
  { title: 'Love Bombing — the trap that feels like a fairytale', hook: 'Too much too soon. That is not love. That is a strategy.', target_emotion: 'shock', pillar: 'manipulation' },
  { title: 'Intermittent Reinforcement — why you are addicted', hook: 'Slot machines use the same trick your ex used on you.', target_emotion: 'curiosity', pillar: 'manipulation' },
  { title: 'Triangulation — using others as weapons', hook: 'They mention someone else just enough to make you insecure. On purpose.', target_emotion: 'shock', pillar: 'manipulation' },
  { title: 'The Silent Treatment — calculated not emotional', hook: 'They are not upset. They are punishing you. There is a difference.', target_emotion: 'shock', pillar: 'manipulation' },
  { title: 'Weaponized Incompetence — pretending to be bad at things', hook: 'They are not bad at it. They are pretending so you do it instead.', target_emotion: 'shock', pillar: 'manipulation' },
  { title: 'Breadcrumbing — just enough to keep you waiting', hook: 'Not enough to commit. Just enough to stop you from leaving.', target_emotion: 'curiosity', pillar: 'manipulation' },
  { title: 'Moving the Goalposts — why you can never satisfy them', hook: 'You did everything they asked. Now there is a new requirement.', target_emotion: 'shock', pillar: 'manipulation' },
  { title: 'Coercive Control — the invisible cage', hook: 'No bruises. No proof. But you are not free.', target_emotion: 'shock', pillar: 'manipulation' },

  // ━━━ PILLAR 2: COGNITIVE BIASES ━━━
  { title: 'The Sunk Cost Fallacy — why you stay too long', hook: 'You stay not because it is good. Because you have already given so much.', target_emotion: 'curiosity', pillar: 'cognitive_bias' },
  { title: 'Confirmation Bias — you only see what you believe', hook: 'Your brain filters out everything that contradicts what you already think.', target_emotion: 'curiosity', pillar: 'cognitive_bias' },
  { title: 'The Halo Effect — why attractive people seem more trustworthy', hook: 'Your brain decided they were a good person before they said a word.', target_emotion: 'curiosity', pillar: 'cognitive_bias' },
  { title: 'Cognitive Dissonance — why smart people stay in bad situations', hook: 'You know it is wrong. You cannot leave. Here is the science why.', target_emotion: 'curiosity', pillar: 'cognitive_bias' },
  { title: 'The Bystander Effect — why nobody helped', hook: 'The more people witness something wrong, the less likely anyone acts.', target_emotion: 'shock', pillar: 'cognitive_bias' },
  { title: 'Anchoring Bias — the first number always wins', hook: 'Whoever speaks first controls the entire negotiation.', target_emotion: 'curiosity', pillar: 'cognitive_bias' },
  { title: 'The Dunning-Kruger Effect — why incompetent people are so confident', hook: 'The less someone knows, the more certain they are they are right.', target_emotion: 'curiosity', pillar: 'cognitive_bias' },
  { title: 'Recency Bias — why one good day erases months of bad ones', hook: 'They had one good week. Suddenly you forgot everything that came before.', target_emotion: 'shock', pillar: 'cognitive_bias' },

  // ━━━ PILLAR 3: BODY LANGUAGE ━━━
  { title: 'Microexpressions — the face that cannot lie', hook: 'The real emotion lasts less than half a second. Here is how to catch it.', target_emotion: 'curiosity', pillar: 'body_language' },
  { title: '3 body language signs someone is lying', hook: 'The body always tells the truth even when the words do not.', target_emotion: 'curiosity', pillar: 'body_language' },
  { title: 'Power Posing — how your body changes your confidence', hook: '2 minutes in this position changes your hormone levels. Scientifically proven.', target_emotion: 'curiosity', pillar: 'body_language' },
  { title: 'Mirroring — why you trust people who copy you', hook: 'They unconsciously mirror your movements. Your brain reads it as connection.', target_emotion: 'curiosity', pillar: 'body_language' },
  { title: 'Eye contact — how much is confidence vs aggression', hook: 'Too little: untrustworthy. Too much: threatening. The exact ratio matters.', target_emotion: 'curiosity', pillar: 'body_language' },
  { title: 'How to detect fake smiles instantly', hook: 'A real smile reaches the eyes. A fake one stops at the mouth. Always.', target_emotion: 'curiosity', pillar: 'body_language' },

  // ━━━ PILLAR 4: POWER DYNAMICS ━━━
  { title: 'Law 1 of Power — never outshine the master', hook: 'The most talented person in the room is not always the safest.', target_emotion: 'curiosity', pillar: 'power' },
  { title: 'The 48 Laws of Power — Law 3', hook: 'Conceal your intentions. Never show your hand until you must.', target_emotion: 'curiosity', pillar: 'power' },
  { title: 'Why silence is the ultimate power move', hook: 'The person who speaks first in a negotiation almost always loses.', target_emotion: 'curiosity', pillar: 'power' },
  { title: 'How to command respect without saying a word', hook: 'Respect is not demanded. It is communicated through behavior.', target_emotion: 'curiosity', pillar: 'power' },
  { title: 'The psychology of saying no', hook: 'Every time you say yes when you mean no, you lose a piece of your power.', target_emotion: 'curiosity', pillar: 'power' },
  { title: 'Workplace manipulation — how to spot it and stop it', hook: 'Office politics is just manipulation with a dress code.', target_emotion: 'shock', pillar: 'power' },

  // ━━━ PILLAR 5: CULT PSYCHOLOGY ━━━
  { title: 'The BITE Model — how cults control you', hook: 'Behavior. Information. Thought. Emotion. They control all four.', target_emotion: 'shock', pillar: 'cult' },
  { title: 'How cult leaders use these 3 techniques on you', hook: 'You do not join a cult knowing it is a cult. That is the point.', target_emotion: 'shock', pillar: 'cult' },
  { title: 'Love bombing — the cult recruitment tactic', hook: 'Cults do not start with control. They start with overwhelming love.', target_emotion: 'shock', pillar: 'cult' },
  { title: 'Thought stopping techniques in cults', hook: 'They give you a phrase to repeat whenever you start to question things.', target_emotion: 'shock', pillar: 'cult' },
  { title: 'Us vs them mentality — the first sign of a cult', hook: 'The moment a group tells you outsiders cannot be trusted — that is the trap.', target_emotion: 'shock', pillar: 'cult' },

  // ━━━ PILLAR 6: SOCIAL ENGINEERING ━━━
  { title: 'Pretexting — the con artist technique used on you daily', hook: 'They created a false scenario. You never questioned it. Here is why.', target_emotion: 'shock', pillar: 'social_engineering' },
  { title: 'The psychology of scams — why smart people get fooled', hook: 'Scammers do not target stupid people. They target trusting ones.', target_emotion: 'shock', pillar: 'social_engineering' },
  { title: 'Urgency as a manipulation weapon', hook: 'The moment someone creates artificial urgency, they are manipulating you.', target_emotion: 'shock', pillar: 'social_engineering' },
  { title: 'Social proof manipulation — why crowds are dangerous', hook: 'Everyone else is doing it. That is not a reason. That is a trap.', target_emotion: 'curiosity', pillar: 'social_engineering' },
  { title: 'Authority bias — why we obey without questioning', hook: 'A uniform. A title. A confident voice. That is all it takes.', target_emotion: 'curiosity', pillar: 'social_engineering' },
  { title: 'The foot in the door technique', hook: 'They start with a small request. The big one comes later.', target_emotion: 'curiosity', pillar: 'social_engineering' },

  // ━━━ PILLAR 7: SELF MASTERY ━━━
  { title: 'The Grey Rock Method — become boring to toxic people', hook: 'The Grey Rock Method will make a narcissist lose interest in you instantly.', target_emotion: 'curiosity', pillar: 'self_mastery' },
  { title: 'Radical acceptance — the most powerful thing you can do', hook: 'Stop fighting reality. Start changing your response to it.', target_emotion: 'curiosity', pillar: 'self_mastery' },
  { title: 'Stoic anger — how Marcus Aurelius handled rage', hook: 'You will not be punished for your anger. You will be punished by it.', target_emotion: 'curiosity', pillar: 'self_mastery' },
  { title: 'How to set boundaries without guilt', hook: 'A boundary is not a punishment. It is a declaration of self-respect.', target_emotion: 'curiosity', pillar: 'self_mastery' },
  { title: 'The psychology of no contact', hook: 'No contact is not about punishing them. It is about healing yourself.', target_emotion: 'curiosity', pillar: 'self_mastery' },
  { title: 'Emotional detachment — how to stop being controlled by your feelings', hook: 'Detachment is not coldness. It is freedom.', target_emotion: 'curiosity', pillar: 'self_mastery' },
  { title: 'How to spot manipulation in real time', hook: 'Once you see the pattern, you cannot unsee it. Here is the pattern.', target_emotion: 'curiosity', pillar: 'self_mastery' },
];
