
import { useCallback } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { Progress } from '@/components/ui/progress';

import { useToast } from '@/components/ui/use-toast';

export function FileUploader({ onUpload, uploading, progress = 0 }) {
  const { toast } = useToast();

  const onDrop = useCallback((acceptedFiles, fileRejections) => {
    // Handle rejections
    if (fileRejections?.length > 0) {
      fileRejections.forEach(({ file, errors }) => {
        errors.forEach(e => {
          if (e.code === 'file-too-large') {
            toast({ variant: 'destructive', title: 'File Too Large', description: `${file.name} exceeds the 50MB limit.` });
          } else if (e.code === 'file-invalid-type') {
            toast({ variant: 'destructive', title: 'Invalid File Type', description: `${file.name} is not supported.` });
          } else {
            toast({ variant: 'destructive', title: 'Upload Failed', description: `${file.name}: ${e.message}` });
          }
        });
      });
    }

    if (acceptedFiles?.length > 0) {
      onUpload(acceptedFiles);
    }
  }, [onUpload, toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize: 50 * 1024 * 1024, // 50MB
    accept: {
      'image/*': [],
      'video/*': [],
      'application/pdf': []
    }
  });

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
          ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}
          ${uploading ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        <input {...getInputProps()} />

        {uploading ? (
          <div className="flex flex-col items-center justify-center py-4">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
            <p className="text-sm font-medium text-slate-700">Uploading files...</p>
            {progress > 0 && <Progress value={progress} className="w-64 mt-4" />}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-4">
            <div className="bg-blue-100 p-4 rounded-full mb-4">
              <Upload className="w-6 h-6 text-blue-600" />
            </div>
            <p className="text-lg font-medium text-slate-700 mb-1">
              {isDragActive ? 'Drop files here' : 'Drag & drop files here'}
            </p>
            <p className="text-sm text-slate-500 mb-4">or click to browse</p>
            <div className="text-xs text-slate-400">
              Supports images, videos, documents up to 10MB
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
