import type {
  MediaProcessor,
  ProbeOutput,
  ThumbnailConfig,
  SpriteConfig,
  TranscodeConfig,
  RenderTimelinePayload,
} from '@project/shared';
import { ProcessingProvider } from '@project/shared';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { TypedPocketBase } from '@project/shared/types';
import { FFmpegTimelineRenderer } from '../render_timeline/ffmpeg.js';

const execFileAsync = promisify(execFile);

/**
 * FFprobe output structure
 */
interface FFprobeOutput {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    profile?: string;
    width?: number;
    height?: number;
    display_aspect_ratio?: string;
    pix_fmt?: string;
    level?: string | number;
    color_space?: string;
    avg_frame_rate?: string;
    bit_rate?: string;
    channels?: number;
    sample_rate?: string;
  }>;
  format?: {
    filename?: string;
    nb_streams?: number;
    nb_programs?: number;
    format_name?: string;
    format_long_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
    probe_score?: number;
  };
}

/**
 * FFmpeg-based media processor
 * Handles media file processing using FFmpeg and ffprobe
 */
export class FFmpegProcessor implements MediaProcessor {
  readonly provider = ProcessingProvider.FFMPEG;
  readonly version = '7.0.1'; // FFmpeg version

  private pb: TypedPocketBase | null = null;
  private tempDir: string | null = null;

  /**
   * Initialize the processor with optional PocketBase client for file resolution
   * @param pb Optional PocketBase client for resolving file references
   */
  constructor(pb?: TypedPocketBase) {
    this.pb = pb || null;
  }

  /**
   * Get or create a temporary directory for processing files
   */
  private async getTempDir(): Promise<string> {
    if (!this.tempDir) {
      // Find worker root (where package.json lives)
      // ffmpeg.ts is in worker/src/processors/transcode/
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const workerRoot = path.resolve(__dirname, '../../../..');
      const dataDir = path.join(workerRoot, 'data');

      await fs.mkdir(dataDir, { recursive: true });
      this.tempDir = await fs.mkdtemp(path.join(dataDir, 'ffmpeg-'));
    }
    return this.tempDir;
  }

  /**
   * Resolve a file reference to a local file path
   * Handles both local paths and PocketBase file references
   * @param fileRef - File reference (local path, Media ID, Upload ID, or File record ID)
   * @returns Local file path
   */
  private async resolveFileRef(fileRef: string): Promise<string> {
    // If it's already a local path, return it
    if (
      path.isAbsolute(fileRef) &&
      (await fs
        .access(fileRef)
        .then(() => true)
        .catch(() => false))
    ) {
      return fileRef;
    }

    // If we don't have PocketBase, we can't resolve remote references
    if (!this.pb) {
      throw new Error(
        `Cannot resolve file reference "${fileRef}": PocketBase client not provided. ` +
          `Either provide a PocketBase client to the processor or use local file paths.`
      );
    }

    // Try to resolve as Media ID first (for timeline rendering)
    try {
      const media = await this.pb.collection('Media').getOne(fileRef);
      if (media.UploadRef) {
        // Get the upload record to access the original file
        const upload = await this.pb
          .collection('Uploads')
          .getOne(media.UploadRef);
        if (upload.originalFile) {
          const filename = Array.isArray(upload.originalFile)
            ? upload.originalFile[0]
            : upload.originalFile;
          const fileUrl = this.pb.files.getURL(upload, filename);
          // Use upload ID as identifier
          return await this.downloadFile(fileUrl, filename, upload.id);
        }
      }
    } catch {
      // Not a Media ID, continue to try other types
    }

    // Try to resolve as Upload ID
    try {
      const upload = await this.pb.collection('Uploads').getOne(fileRef);
      if (upload.originalFile) {
        const filename = Array.isArray(upload.originalFile)
          ? upload.originalFile[0]
          : upload.originalFile;
        const fileUrl = this.pb.files.getURL(upload, filename);
        // Use upload ID as identifier
        return await this.downloadFile(fileUrl, filename, upload.id);
      }
    } catch {
      // Not an upload ID, try File record ID
    }

    // Try to resolve as File record ID
    try {
      const fileRecord = await this.pb.collection('Files').getOne(fileRef);
      const blob = (fileRecord as unknown as Record<string, unknown>).file;
      if (blob) {
        const filename = Array.isArray(blob) ? blob[0] : (blob as string);
        const fileUrl = this.pb.files.getURL(fileRecord, filename);
        // Use file record ID as identifier
        return await this.downloadFile(fileUrl, filename, fileRecord.id);
      }
    } catch {
      // Not a file record ID either
    }

    throw new Error(`Cannot resolve file reference: ${fileRef}`);
  }

  /**
   * Generate a clean temp file name using identifier and operation type
   * @param identifier - Upload ID or file ID
   * @param operationType - Type of operation (e.g., 'thumbnail', 'spritesheet', 'proxy', 'original')
   * @param extension - File extension (e.g., 'jpg', 'mp4')
   * @param version - Optional version suffix (defaults to 'v1')
   * @returns Clean file name
   */
  private generateTempFileName(
    identifier: string | undefined,
    operationType: string,
    extension: string,
    version: string = 'v1'
  ): string {
    if (identifier) {
      return `${identifier}_${operationType}_${version}.${extension}`;
    }
    // Fallback to timestamp-based naming if no identifier provided
    return `${operationType}_${Date.now()}_${version}.${extension}`;
  }

  /**
   * Download a file from a URL to a temporary location
   * @param url - File URL
   * @param filename - Original filename (for fallback naming)
   * @param identifier - Optional identifier (upload ID or file ID) for temp file naming
   * @returns Local file path
   */
  private async downloadFile(
    url: string,
    filename: string,
    identifier?: string
  ): Promise<string> {
    const tempDir = await this.getTempDir();

    // Extract extension from original filename
    const ext = path.extname(filename).slice(1) || 'bin';
    const localPath = path.join(
      tempDir,
      this.generateTempFileName(identifier, 'original', ext)
    );

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to download file from ${url}: ${response.statusText}`
      );
    }

    const buffer = await response.arrayBuffer();
    await fs.writeFile(localPath, Buffer.from(buffer));

    return localPath;
  }

  /**
   * Execute ffprobe command and parse JSON output
   * @param inputFile - Input file path
   * @returns Parsed probe output
   */
  private async runFFprobe(inputFile: string): Promise<FFprobeOutput> {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_format',
        '-show_streams',
        '-of',
        'json',
        inputFile,
      ]);

      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(
        `ffprobe failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Parse ffprobe output to ProbeOutput format
   * @param probeData - Raw ffprobe JSON output
   * @returns Formatted probe output
   */
  private parseProbeOutput(probeData: FFprobeOutput): ProbeOutput {
    const videoStream = probeData.streams?.find(
      (s) => s.codec_type === 'video'
    );
    const audioStream = probeData.streams?.find(
      (s) => s.codec_type === 'audio'
    );

    if (!videoStream) {
      throw new Error('No video stream found in media file');
    }

    const format = probeData.format || {};

    // Parse frame rate (e.g., "30/1" -> 30)
    let fps = 30; // default
    if (videoStream.avg_frame_rate) {
      const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
      if (den && den > 0) {
        fps = num / den;
      }
    }

    // Parse bitrate (can be from stream or format)
    const bitrate = videoStream.bit_rate
      ? parseInt(videoStream.bit_rate, 10)
      : format.bit_rate
        ? parseInt(format.bit_rate, 10)
        : undefined;

    const output: ProbeOutput = {
      duration: parseFloat(format.duration || '0'),
      width: videoStream.width || 0,
      height: videoStream.height || 0,
      codec: videoStream.codec_name || 'unknown',
      fps: Math.round(fps * 100) / 100, // Round to 2 decimal places
      bitrate,
      format: format.format_name,
      size: format.size ? parseInt(format.size, 10) : undefined,
      video: {
        codec: videoStream.codec_name || 'unknown',
        profile: videoStream.profile,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        aspectRatio: videoStream.display_aspect_ratio,
        pixFmt: videoStream.pix_fmt,
        level: videoStream.level?.toString(),
        colorSpace: videoStream.color_space,
      },
    };

    if (audioStream) {
      output.audio = {
        codec: audioStream.codec_name || 'unknown',
        channels: audioStream.channels || 0,
        sampleRate: audioStream.sample_rate
          ? parseInt(audioStream.sample_rate, 10)
          : 0,
        bitrate: audioStream.bit_rate
          ? parseInt(audioStream.bit_rate, 10)
          : undefined,
      };
    }

    return output;
  }

  /**
   * Probe a media file to extract metadata using ffprobe
   * @param fileRef - Reference to the file (PocketBase file path or File record ID)
   * @returns Metadata about the media file
   */
  async probe(fileRef: string): Promise<ProbeOutput> {
    console.log(`[FFmpegProcessor] Probing file: ${fileRef}`);

    const inputFile = await this.resolveFileRef(fileRef);
    const probeData = await this.runFFprobe(inputFile);
    const output = this.parseProbeOutput(probeData);

    console.log(`[FFmpegProcessor] Probe result:`, output);
    return output;
  }

  /**
   * Generate a thumbnail image from the media file using ffmpeg
   * @param fileRef - Reference to the source media file
   * @param config - Thumbnail generation configuration
   * @param identifier - Optional identifier (upload ID or file ID) for temp file naming
   * @returns Path to the generated thumbnail file
   */
  async generateThumbnail(
    fileRef: string,
    config: ThumbnailConfig,
    identifier?: string
  ): Promise<string> {
    console.log(
      `[FFmpegProcessor] Generating thumbnail for: ${fileRef}`,
      config
    );

    const inputFile = await this.resolveFileRef(fileRef);
    const tempDir = await this.getTempDir();

    // Determine timestamp
    let timestamp: number;
    if (config.timestamp === 'midpoint') {
      // Get video duration first
      const probeData = await this.runFFprobe(inputFile);
      const duration = parseFloat(probeData.format?.duration || '0');
      timestamp = duration / 2;
    } else {
      timestamp = config.timestamp;
    }

    // Generate output filename using identifier
    const outputFilename = this.generateTempFileName(
      identifier,
      'thumbnail',
      'jpg'
    );
    const outputPath = path.join(tempDir, outputFilename);

    // Build ffmpeg command
    const args = [
      '-i',
      inputFile,
      '-ss',
      timestamp.toString(),
      '-vframes',
      '1',
      '-vf',
      `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`,
      '-q:v',
      '2', // High quality JPEG
      '-y', // Overwrite output file
      outputPath,
    ];

    try {
      await execFileAsync('ffmpeg', args);
      console.log(`[FFmpegProcessor] Thumbnail generated: ${outputPath}`);
      return outputPath;
    } catch (error) {
      throw new Error(
        `FFmpeg thumbnail generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate a sprite sheet from the media file using ffmpeg
   * @param fileRef - Reference to the source media file
   * @param config - Sprite sheet generation configuration
   * @param identifier - Optional identifier (upload ID or file ID) for temp file naming
   * @returns Path to the generated sprite sheet file
   */
  async generateSprite(
    fileRef: string,
    config: SpriteConfig,
    identifier?: string
  ): Promise<string> {
    console.log(
      `[FFmpegProcessor] Generating sprite sheet for: ${fileRef}`,
      config
    );

    const inputFile = await this.resolveFileRef(fileRef);
    const tempDir = await this.getTempDir();

    // Generate output filename using identifier
    const outputFilename = this.generateTempFileName(
      identifier,
      'spritesheet',
      'jpg'
    );
    const outputPath = path.join(tempDir, outputFilename);

    // Build ffmpeg command for sprite sheet generation
    // The tile filter combines multiple input frames into a single tiled output frame
    // We use -frames:v 1 to specify we want only 1 output frame (the final sprite sheet)
    // and -update to tell image2 muxer to update the same file instead of creating multiple files
    const args = [
      '-i',
      inputFile,
      '-vf',
      `fps=${config.fps},scale=${config.tileWidth}:${config.tileHeight}:force_original_aspect_ratio=decrease,pad=${config.tileWidth}:${config.tileHeight}:(ow-iw)/2:(oh-ih)/2,tile=${config.cols}x${config.rows}`,
      '-frames:v',
      '1', // Tile filter produces a single output frame containing all tiles
      '-update',
      '1', // Update the same file for each frame (needed for single file output)
      '-q:v',
      '2', // High quality JPEG
      '-y', // Overwrite output file
      outputPath,
    ];

    try {
      await execFileAsync('ffmpeg', args);
      console.log(`[FFmpegProcessor] Sprite sheet generated: ${outputPath}`);
      return outputPath;
    } catch (error) {
      throw new Error(
        `FFmpeg sprite sheet generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Transcode the media file to a different format using ffmpeg
   * @param fileRef - Reference to the source media file
   * @param config - Transcoding configuration
   * @param outputFileName - Optional deterministic output filename (overrides identifier-based naming)
   * @param identifier - Optional identifier (upload ID or file ID) for temp file naming
   * @returns Path to the transcoded file
   */
  async transcode(
    fileRef: string,
    config: TranscodeConfig,
    outputFileName?: string,
    identifier?: string
  ): Promise<string> {
    console.log(`[FFmpegProcessor] Transcoding file: ${fileRef}`, config);

    if (!config.enabled) {
      throw new Error('Transcoding is not enabled in config');
    }

    const inputFile = await this.resolveFileRef(fileRef);
    const tempDir = await this.getTempDir();

    // Determine resolution
    // ... (logic remains same)
    let resolution: string;
    switch (config.resolution) {
      case '720p':
        resolution = '1280:720';
        break;
      case '1080p':
        resolution = '1920:1080';
        break;
      case 'original': {
        // Get original resolution from probe
        const probeData = await this.runFFprobe(inputFile);
        const videoStream = probeData.streams?.find(
          (s) => s.codec_type === 'video' || s.codec_name
        );
        if (videoStream) {
          resolution = `${videoStream.width}:${videoStream.height}`;
        } else {
          resolution = '1920:1080'; // fallback
        }
        break;
      }
      default:
        resolution = '1920:1080';
    }

    // Determine codec arguments
    let codecArgs: string[] = [];
    switch (config.codec) {
      case 'h264':
        codecArgs = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23'];
        break;
      case 'h265':
        codecArgs = ['-c:v', 'libx265', '-preset', 'medium', '-crf', '28'];
        break;
      case 'vp9':
        codecArgs = ['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0'];
        break;
    }

    // Add bitrate if specified
    if (config.bitrate) {
      codecArgs.push('-b:v', config.bitrate.toString());
    }

    // Generate output filename - use provided outputFileName if given, otherwise use identifier-based naming
    const finalOutputFilename =
      outputFileName || this.generateTempFileName(identifier, 'proxy', 'mp4');
    const outputPath = path.join(tempDir, finalOutputFilename);

    // Build ffmpeg command
    const args = [
      '-i',
      inputFile,
      '-vf',
      `scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution.split(':')[0]}:${resolution.split(':')[1]}:(${resolution.split(':')[0]}-iw)/2:(${resolution.split(':')[1]}-ih)/2`,
      ...codecArgs,
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      '-y', // Overwrite output file
      outputPath,
    ];

    try {
      await execFileAsync('ffmpeg', args);
      console.log(`[FFmpegProcessor] Transcoding completed: ${outputPath}`);
      return outputPath;
    } catch (error) {
      throw new Error(
        `FFmpeg transcoding failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Render a timeline to a single video file using FFmpeg
   * @param payload - The full render task payload containing edit list and settings
   * @returns Path to the generated output file
   */
  async renderTimeline(payload: RenderTimelinePayload): Promise<string> {
    console.log(`[FFmpegProcessor] Rendering timeline`);

    const tempDir = await this.getTempDir();
    const renderer = new FFmpegTimelineRenderer();

    // Use the renderer with our resolveFileRef method
    const outputPath = await renderer.render(
      payload,
      (ref: string) => this.resolveFileRef(ref),
      tempDir
    );

    console.log(`[FFmpegProcessor] Timeline rendered: ${outputPath}`);
    return outputPath;
  }

  /**
   * Clean up temporary files
   * Call this when done processing to free up disk space
   */
  async cleanup(): Promise<void> {
    if (this.tempDir) {
      try {
        await fs.rm(this.tempDir, { recursive: true, force: true });
        this.tempDir = null;
      } catch (error) {
        console.warn(
          `[FFmpegProcessor] Failed to cleanup temp directory: ${error}`
        );
      }
    }
  }
}
