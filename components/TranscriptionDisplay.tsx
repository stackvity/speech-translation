
import React from 'react';

interface TranscriptionDisplayProps {
  title: string;
  text: string;
}

export const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({ title, text }) => {
  return (
    <div className="w-full bg-gray-800 p-4 rounded-lg shadow-inner">
      <h3 className="text-sm font-semibold text-blue-400 mb-2">{title}</h3>
      <p className="text-gray-200 min-h-[5rem] whitespace-pre-wrap">{text || '...'}</p>
    </div>
  );
};
