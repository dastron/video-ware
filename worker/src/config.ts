export interface ProcessorConfig {
  ENABLE_FFMPEG: boolean;
  ENABLE_GOOGLE_TRANSCODER: boolean;
  ENABLE_GOOGLE_VIDEO_INTELLIGENCE: boolean;
  ENABLE_GOOGLE_SPEECH: boolean;
}

export const processorConfig: ProcessorConfig = {
  ENABLE_FFMPEG: process.env.ENABLE_FFMPEG !== 'false', // Default true
  ENABLE_GOOGLE_TRANSCODER: process.env.ENABLE_GOOGLE_TRANSCODER === 'true', // Default false
  ENABLE_GOOGLE_VIDEO_INTELLIGENCE:
    process.env.ENABLE_GOOGLE_VIDEO_INTELLIGENCE === 'true', // Default false
  ENABLE_GOOGLE_SPEECH: process.env.ENABLE_GOOGLE_SPEECH === 'true', // Default false
};
