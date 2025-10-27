// FIX: The type `LiveSession` is not exported from `@google/genai`.
import { GoogleGenAI, Modality, type LiveCallbacks } from '@google/genai';
import type { Language } from '../types';

let ai: GoogleGenAI;

function getAi() {
    if (!ai) {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable not set");
        }
        ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }
    return ai;
}


// FIX: The return type `Promise<LiveSession>` was removed because `LiveSession` is not an exported type.
// The return type is now correctly inferred from `ai.live.connect`.
export function connectToLive(callbacks: LiveCallbacks, sourceLang: Language, targetLang: Language) {
    const ai = getAi();
    return ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks,
        config: {
            systemInstruction: `You are a real-time speech translator. The user will speak in ${sourceLang.name}. Your task is to listen to the user, translate their speech into ${targetLang.name}, and respond immediately with the translated speech. Do not add any commentary or extra text. Just provide the direct translation.`,
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: targetLang.ttsVoice },
                },
            },
        },
    });
}
