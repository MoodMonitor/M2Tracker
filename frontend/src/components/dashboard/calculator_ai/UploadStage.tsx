import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, TestTube2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface UploadStageProps {
  onFileAccepted: (file: File) => void;
  isLoading: boolean;
  skipSteps: boolean;
  onSkipChange: (checked: boolean) => void;
  onDemoClick: () => void;
  onPaste: (event: React.ClipboardEvent) => void;
}

export function UploadStage({
  onFileAccepted,
  isLoading,
  skipSteps,
  onSkipChange,
  onPaste,
  onDemoClick,
}: UploadStageProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFileAccepted(acceptedFiles[0]);
      }
    },
    [onFileAccepted]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.png', '.jpg', '.webp'] },
    multiple: false,
    disabled: isLoading,
  });

  return (
    <div className="flex flex-col h-full gap-4">
      <div
        {...getRootProps()}
        className={`flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors
          ${isDragActive ? 'border-orange-400 bg-orange-400/10' : 'border-slate-700 hover:border-slate-500'}
          ${isLoading ? 'cursor-wait opacity-50' : ''}`}
      >
        <input {...getInputProps()} />
        <UploadCloud className="h-16 w-16 text-slate-500 mb-4" />
        <h3 className="text-xl font-semibold text-slate-200">
          {isDragActive ? 'Upuść plik tutaj...' : 'Przeciągnij i upuść zrzut ekranu'}
        </h3>
        <p className="text-slate-400 mt-2">lub kliknij, aby wybrać plik.</p>
      </div>

      {/* Paste target — read-only, only used to capture Ctrl+V */}
      <Input
        type="text"
        placeholder="...lub kliknij tutaj i wklej (Ctrl+V)"
        onPaste={onPaste}
        aria-label="Pole do wklejania zrzutu ekranu"
        className="text-center bg-[#0B1119]/85 border-[#141B24] text-slate-200 placeholder:text-slate-500"
        readOnly
      />

      <div className="flex items-center justify-center gap-4">
        <Button variant="outline" onClick={onDemoClick} disabled={isLoading}>
          <TestTube2 className="h-4 w-4 mr-2" />
          Wypróbuj na przykładzie
        </Button>
      </div>

      <div className="flex items-center space-x-2 p-2 justify-center">
        <Checkbox
          id="skip-steps"
          checked={skipSteps}
          onCheckedChange={(v) => onSkipChange(Boolean(v))}
          disabled={isLoading}
        />
        <label
          htmlFor="skip-steps"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-slate-300"
        >
          Pomiń weryfikację i oblicz od razu
        </label>
      </div>
    </div>
  );
}