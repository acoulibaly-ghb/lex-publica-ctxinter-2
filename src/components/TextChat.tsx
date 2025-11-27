
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { Message } from '../types';
import { SYSTEM_INSTRUCTION } from '../constants';
import { decodeAudioData, playAudioBuffer } from '../utils/audio-utils';

// --- Markdown Component Helper ---
const parseBold = (text: string) => {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold underline decoration-indigo-300/50 underline-offset-2">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

const SimpleMarkdown = ({ text, isUser }: { text: string, isUser: boolean }) => {
  if (!text) return null;
  
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: React.ReactNode[] = [];

  const flushList = (key: string) => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={key} className="list-disc pl-5 mb-3 space-y-1.5 marker:text-indigo-400">
          {[...currentList]}
        </ul>
      );
      currentList = [];
    }
  };

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    
    // Titles (###)
    if (line.startsWith('### ')) {
      flushList(`list-before-${index}`);
      elements.push(
        <h3 key={`h3-${index}`} className={`text-lg font-bold mt-4 mb-2 ${isUser ? 'text-white' : 'text-indigo-800'}`}>
          {parseBold(line.replace('### ', ''))}
        </h3>
      );
    } 
    // Titles (##)
    else if (line.startsWith('## ')) {
        flushList(`list-before-${index}`);
        elements.push(
          <h2 key={`h2-${index}`} className={`text-xl font-bold mt-5 mb-3 ${isUser ? 'text-white' : 'text-indigo-900'}`}>
            {parseBold(line.replace('## ', ''))}
          </h2>
        );
      } 
    // List items
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      currentList.push(
        <li key={`item-${index}`}>
          {parseBold(line.replace(/^[-*] /, ''))}
        </li>
      );
    } 
    // Standard paragraphs
    else {
      if (trimmedLine !== '') {
        flushList(`list-before-${index}`);
        elements.push(
          <p key={`p-${index}`} className="mb-3 last:mb-0">
            {parseBold(line)}
          </p>
        );
      } else {
          // Empty line, maybe flush list
          flushList(`list-before-${index}`);
      }
    }
  });

  flushList('list-end');

  return <div className="text-sm leading-relaxed">{elements}</div>;
};
// ---------------------------------

const TextChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: '### Bonjour !\n\nJe suis votre assistant juridique spécialisé en droit administratif.\n\nJe peux vous aider sur les thèmes suivants :\n- **Les actes administratifs unilatéraux**\n- **La police administrative**\n- **Le service public**\n\nQuelle est votre question ?', timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Stream refs
  const audioQueueRef = useRef<string[]>([]);
  const isProcessingQueueRef = useRef(false);

  // Récupération de la clé API compatible Vite
  const API_KEY = import.meta.env.VITE_API_KEY;

  const suggestions = [
    "Qu'est-ce qu'un service public ?",
    "L'arrêt Benjamin et la police administrative",
    "Différence entre SPA et SPIC",
    "Définition d'un acte réglementaire"
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    return () => {
        if (audioContextRef.current) {
            audioContextRef.current.close();
        }
    };
  }, []);

  // Audio Queue Processing
  const processAudioQueue = async () => {
    if (isProcessingQueueRef.current || audioQueueRef.current.length === 0) return;
    
    isProcessingQueueRef.current = true;
    const textChunk = audioQueueRef.current.shift();

    if (textChunk) {
        try {
            await generateAndPlayTTS(textChunk);
        } catch (e) {
            console.error("Queue processing error", e);
        }
    }

    isProcessingQueueRef.current = false;
    if (audioQueueRef.current.length > 0) {
        processAudioQueue();
    } else {
        setIsPlayingAudio(false);
    }
  };

  const addToAudioQueue = (text: string) => {
      if (!text.trim()) return;
      audioQueueRef.current.push(text);
      setIsPlayingAudio(true);
      processAudioQueue();
  };

  const generateAndPlayTTS = async (text: string) => {
    if (!API_KEY) {
        console.error("Clé API manquante");
        return;
    }
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                },
            },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) return;

        if (!audioContextRef.current) {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
        }

        if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }

        const audioBuffer = await decodeAudioData(base64Audio, audioContextRef.current);
        
        await new Promise<void>((resolve) => {
            if (!audioContextRef.current) { resolve(); return; }
            const source = audioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContextRef.current.destination);
            source.onended = () => resolve();
            source.start();
        });

    } catch (error) {
        console.error("Erreur TTS:", error);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    
    if (!API_KEY) {
        setMessages(prev => [...prev, { role: 'model', text: "### Erreur de Configuration\n\nLa clé API est manquante. Veuillez configurer la variable d'environnement `VITE_API_KEY`.", timestamp: new Date() }]);
        return;
    }

    // Reset Audio
    if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
    }
    audioQueueRef.current = [];
    isProcessingQueueRef.current = false;
    setIsPlayingAudio(false);

    const userMsg: Message = { role: 'user', text: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      
      const result = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: text,
        config: {
            systemInstruction: SYSTEM_INSTRUCTION
        }
      });

      let fullText = '';
      let sentenceBuffer = '';
      
      // Initialize model message
      setMessages(prev => [...prev, { role: 'model', text: '', timestamp: new Date() }]);

      for await (const chunk of result) {
          const chunkText = chunk.text; 
          if (chunkText) {
            fullText += chunkText;
            sentenceBuffer += chunkText;
  
            // Update UI progressively
            setMessages(prev => {
                const newArr = [...prev];
                newArr[newArr.length - 1].text = fullText;
                return newArr;
            });
  
            // Check for sentence completion to queue TTS
            // Regex matches punctuation (. ? !) followed by space or end of string
            const sentences = sentenceBuffer.match(/[^.?!]+[.?!]+(\s|$)/g);
            if (sentences) {
                sentences.forEach(sentence => {
                    addToAudioQueue(sentence);
                });
                // Keep remainder in buffer
                const lastMatch = sentences[sentences.length - 1];
                const lastIndex = sentenceBuffer.lastIndexOf(lastMatch);
                sentenceBuffer = sentenceBuffer.substring(lastIndex + lastMatch.length);
            }
          }
      }

      // Process any remaining text in buffer
      if (sentenceBuffer.trim()) {
          addToAudioQueue(sentenceBuffer);
      }

      setIsLoading(false);

    } catch (error) {
      console.error(error);
      const errorMsg: Message = {
        role: 'model',
        text: "### Erreur\n\nUne erreur est survenue lors de la consultation des documents.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
      setIsLoading(false);
    }
  };

  const handleSend = () => sendMessage(input);

  // Icons
  const UserIcon = () => (
    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white shadow-md ring-2 ring-white">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
    </div>
  );

  const BotIcon = () => (
    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-md ring-2 ring-white relative">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"></path></svg>
      {isPlayingAudio && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-indigo-400 rounded-full animate-ping"></span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-[600px] relative bg-slate-50/50">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-in fade-in slide-in-from-bottom-4 duration-500`}
          >
            <div className="flex-shrink-0 mt-1">
              {msg.role === 'user' ? <UserIcon /> : <BotIcon />}
            </div>
            
            <div
              className={`max-w-[80%] rounded-2xl px-5 py-4 text-sm shadow-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-tr-sm'
                  : 'bg-white text-slate-700 rounded-tl-sm border border-slate-100'
              }`}
            >
                {/* Use SimpleMarkdown component here */}
                <SimpleMarkdown text={msg.text} isUser={msg.role === 'user'} />
                
                <div className={`text-[10px] mt-2 opacity-70 ${msg.role === 'user' ? 'text-indigo-100 text-right' : 'text-slate-400'}`}>
                    {msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>
            </div>
          </div>
        ))}
        
        {isLoading && (
           <div className="flex gap-4 animate-pulse">
             <div className="flex-shrink-0 mt-1"><BotIcon /></div>
             <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-sm px-4 py-4 shadow-sm flex items-center space-x-1.5 h-14">
               <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"></div>
               <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce delay-75"></div>
               <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce delay-150"></div>
             </div>
           </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions & Input Area */}
      <div className="p-4 bg-white border-t border-slate-100 relative z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        
        {/* Suggestions Chips */}
        {messages.length < 3 && !isLoading && (
            <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
                {suggestions.map((s, i) => (
                    <button 
                        key={i}
                        onClick={() => sendMessage(s)}
                        className="whitespace-nowrap px-3 py-1.5 bg-indigo-50 text-indigo-600 text-xs font-medium rounded-full border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 transition-colors"
                    >
                        {s}
                    </button>
                ))}
            </div>
        )}

        <div className="relative flex items-center gap-2 bg-slate-50 p-2 rounded-3xl border border-slate-200 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100 transition-all shadow-inner">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Posez votre question juridique..."
            className="flex-1 bg-transparent px-4 py-2 focus:outline-none text-slate-700 placeholder-slate-400"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white p-3 rounded-2xl transition-all shadow-md hover:shadow-lg flex-shrink-0"
          >
            <svg className="w-5 h-5 transform rotate-90 translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default TextChat;
