import React, { useState, useRef, useCallback, useEffect } from 'react';
// FIX: The type `LiveSession` is not exported from `@google/genai`.
import { type LiveServerMessage, type Blob } from '@google/genai';
import { Status, type Language } from './types';
import { LANGUAGES } from './constants';
import { connectToLive } from './services/geminiService';
import { decode, decodeAudioData, encode } from './utils/audioUtils';
import { LanguageSelector } from './components/LanguageSelector';
import { TranscriptionDisplay } from './components/TranscriptionDisplay';
import { MicrophoneIcon, SwapIcon } from './components/icons';

// FIX: `LiveSession` type is inferred from the return type of `connectToLive`
// because it is not an exported member of `@google/genai`.
type LiveSession = Awaited<ReturnType<typeof connectToLive>>;

const App: React.FC = () => {
    const [sourceLangCode, setSourceLangCode] = useState<string>('en-US');
    const [targetLangCode, setTargetLangCode] = useState<string>('id-ID');
    const [status, setStatus] = useState<Status>(Status.Idle);
    const [originalText, setOriginalText] = useState('');
    const [translatedText, setTranslatedText] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isRecording, setIsRecording] = useState(false);

    const sessionRef = useRef<LiveSession | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const currentInputTranscription = useRef('');
    const currentOutputTranscription = useRef('');
    const nextAudioStartTime = useRef(0);
    const audioQueue = useRef<string[]>([]);
    const isPlaying = useRef(false);
    const isRecordingRef = useRef(isRecording);

    useEffect(() => {
        isRecordingRef.current = isRecording;
    }, [isRecording]);

    const playAudioQueue = useCallback(async () => {
        if (isPlaying.current || audioQueue.current.length === 0) {
            return;
        }
        isPlaying.current = true;

        if (!outputAudioContextRef.current) {
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const audioContext = outputAudioContextRef.current;

        const base64Audio = audioQueue.current.shift();
        if (base64Audio) {
            try {
                const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContext.destination);

                const currentTime = audioContext.currentTime;
                const startTime = Math.max(currentTime, nextAudioStartTime.current);
                source.start(startTime);
                nextAudioStartTime.current = startTime + audioBuffer.duration;

                source.onended = () => {
                    isPlaying.current = false;
                    if (audioQueue.current.length === 0 && isRecordingRef.current) {
                        setStatus(Status.Listening);
                    }
                    playAudioQueue();
                };
            } catch (error) {
                console.error('Error playing audio:', error);
                isPlaying.current = false;
                if (audioQueue.current.length === 0 && isRecordingRef.current) {
                    setStatus(Status.Listening);
                }
                playAudioQueue(); 
            }
        } else {
            isPlaying.current = false;
        }
    }, []);

    const handleLiveMessage = useCallback(async (message: LiveServerMessage) => {
        if (message.serverContent?.inputTranscription) {
            currentInputTranscription.current += message.serverContent.inputTranscription.text;
            setOriginalText(currentInputTranscription.current);
            setStatus(currentStatus => currentStatus === Status.Listening ? Status.Translating : currentStatus);
        }

        if (message.serverContent?.outputTranscription) {
            currentOutputTranscription.current += message.serverContent.outputTranscription.text;
            setTranslatedText(currentOutputTranscription.current);
        }

        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (base64Audio) {
            setStatus(Status.Speaking);
            audioQueue.current.push(base64Audio);
            playAudioQueue();
        }

        if (message.serverContent?.turnComplete) {
            currentInputTranscription.current = '';
            currentOutputTranscription.current = '';
            // If not currently speaking, reset to listening. Otherwise, playAudioQueue's onended will handle it.
            if (!isPlaying.current && isRecordingRef.current) {
                setStatus(Status.Listening);
            }
        }
    }, [playAudioQueue]);

    const stopSession = useCallback(() => {
        setIsRecording(false);
        setStatus(Status.Idle);

        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
           inputAudioContextRef.current.close();
        }
       
        sessionRef.current?.close();
        
        mediaStreamRef.current = null;
        inputAudioContextRef.current = null;
        sessionRef.current = null;

        audioQueue.current = [];
        isPlaying.current = false;
        nextAudioStartTime.current = 0;
    }, []);

    const startSession = useCallback(async () => {
        if (sessionRef.current || isRecording) return;
        
        setIsRecording(true);
        setStatus(Status.Connecting);
        setErrorMessage('');
        setOriginalText('');
        setTranslatedText('');
        currentInputTranscription.current = '';
        currentOutputTranscription.current = '';

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;

            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            const audioContext = inputAudioContextRef.current;
            
            const source = audioContext.createMediaStreamSource(stream);
            const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            const sourceLang = LANGUAGES.find(l => l.code === sourceLangCode)!;
            const targetLang = LANGUAGES.find(l => l.code === targetLangCode)!;

            const sessionPromise = connectToLive({
                onopen: () => setStatus(Status.Listening),
                onmessage: handleLiveMessage,
                onerror: (e) => {
                    console.error('Live API Error:', e);
                    setErrorMessage('A connection error occurred.');
                    setStatus(Status.Error);
                    stopSession();
                },
                onclose: () => {},
            }, sourceLang, targetLang);

            sessionPromise.then(session => {
                sessionRef.current = session;
            });

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const pcmBlob: Blob = {
                    data: encode(new Uint8Array(new Int16Array(inputData.map(x => x * 32768)).buffer)),
                    mimeType: 'audio/pcm;rate=16000',
                };
                sessionPromise.then((session) => {
                    if (isRecordingRef.current && session) {
                         session.sendRealtimeInput({ media: pcmBlob });
                    }
                });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContext.destination);

        } catch (error) {
            console.error('Failed to start session:', error);
            setErrorMessage('Could not access microphone. Please grant permission and try again.');
            setStatus(Status.Error);
            setIsRecording(false);
        }
    }, [handleLiveMessage, isRecording, sourceLangCode, targetLangCode, stopSession]);

    useEffect(() => {
        return () => {
            stopSession();
        };
    }, [stopSession]);

    const handleToggleRecording = () => {
        if (isRecording) {
            stopSession();
        } else {
            startSession();
        }
    };
    
    const swapLanguages = () => {
        const temp = sourceLangCode;
        setSourceLangCode(targetLangCode);
        setTargetLangCode(temp);
    }
    
    const getStatusColor = () => {
        switch (status) {
            case Status.Listening: return 'border-green-500';
            case Status.Translating:
            case Status.Speaking:
            case Status.Connecting: return 'border-yellow-500';
            case Status.Error: return 'border-red-500';
            default: return 'border-blue-500';
        }
    };


    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4 font-sans">
            <div className="w-full max-w-2xl mx-auto space-y-6">
                <h1 className="text-4xl font-bold text-center text-gray-100">Live Speech Translator</h1>
                <p className="text-center text-gray-400">Speak into your microphone and get a real-time translation.</p>

                <div className="bg-gray-800 p-6 rounded-2xl shadow-lg space-y-6">
                    <div className="flex items-center space-x-4">
                        <LanguageSelector id="source-lang" value={sourceLangCode} onChange={e => setSourceLangCode(e.target.value)} disabled={isRecording}/>
                        <button onClick={swapLanguages} disabled={isRecording} className="p-2 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition">
                            <SwapIcon className="w-6 h-6 text-blue-400" />
                        </button>
                        <LanguageSelector id="target-lang" value={targetLangCode} onChange={e => setTargetLangCode(e.target.value)} disabled={isRecording}/>
                    </div>

                    <div className="flex flex-col items-center justify-center space-y-4">
                       <button
                            onClick={handleToggleRecording}
                            className={`relative flex items-center justify-center w-24 h-24 rounded-full transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-opacity-50 ${isRecording ? 'bg-red-600 hover:bg-red-700 focus:ring-red-400' : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-400'}`}
                        >
                            {isRecording && status === Status.Listening && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
                            <MicrophoneIcon className="w-10 h-10 text-white" />
                        </button>
                        <p className={`text-lg transition-colors duration-300 ${status === Status.Error ? 'text-red-400' : 'text-gray-300'}`}>
                           {status === Status.Error ? errorMessage : status}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <TranscriptionDisplay title="Original" text={originalText} />
                        <TranscriptionDisplay title="Translation" text={translatedText} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;
