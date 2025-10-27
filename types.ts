
export enum Status {
  Idle = 'Idle',
  Connecting = 'Connecting...',
  Listening = 'Listening...',
  Translating = 'Translating...',
  Speaking = 'Speaking...',
  Error = 'Error',
}

export interface Language {
  code: string;
  name: string;
  ttsVoice: string;
}
