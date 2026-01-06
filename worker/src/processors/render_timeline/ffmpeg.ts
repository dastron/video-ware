import {
  type RenderTimelinePayload,
  type RenderTimelineResult,
} from '@project/shared';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Helper class to handle FFmpeg timeline rendering
 */
export class FFmpegTimelineRenderer {
  /**
   * Render a timeline to a single output file
   * @param payload - The render payload
   * @param resolveFileRef - Function to resolve file references to local paths
   * @param tempDir - Directory for temporary files
   * @returns Path to the generated output file
   */
  async render(
    payload: RenderTimelinePayload,
    resolveFileRef: (ref: string) => Promise<string>,
    tempDir: string
  ): Promise<string> {
    console.log(
      `[FFmpegTimelineRenderer] Rendering timeline: ${payload.timelineId}`
    );

    const { editList, outputSettings } = payload;
    const inputs: string[] = [];
    const filterComplex: string[] = [];

    // Map inputs to local paths and build input definitions
    // We need to deduplicate inputs for efficiency, though FFmpeg handles multiple -i fine
    // For simplicity, we'll map each edit list entry's input to a file index
    const inputMap = new Map<string, number>();
    const filePaths: string[] = [];

    // First pass: Resolve all unique inputs
    for (const entry of editList) {
      for (const inputRef of entry.inputs) {
        if (!inputMap.has(inputRef)) {
          const localPath = await resolveFileRef(inputRef);
          inputMap.set(inputRef, filePaths.length);
          filePaths.push(localPath);
        }
      }
    }

    // Prepare filter graph
    // [0:v]trim=start=0:end=10,setpts=PTS-STARTPTS[v0];
    // [0:a]atrim=start=0:end=10,asetpts=PTS-STARTPTS[a0]; ...
    // [v0][a0][v1][a1]...concat=n=2:v=1:a=1[outv][outa]

    let segmentIndex = 0;
    const concatInputs: string[] = [];

    for (const entry of editList) {
      if (entry.inputs.length === 0) continue; // Skip empty entries? Or treat as black implementation?

      // Assuming single input per entry for simple timeline for now
      // The spec allows multiple inputs (e.g. for layering), but basic timeline is usually one video track
      const inputRef = entry.inputs[0];
      const inputIdx = inputMap.get(inputRef);

      if (inputIdx === undefined) {
        throw new Error(`Input reference not found in map: ${inputRef}`);
      }

      // Calculate start and end times in seconds
      const startTime =
        entry.startTimeOffset.seconds + entry.startTimeOffset.nanos / 1e9;
      const endTime =
        entry.endTimeOffset.seconds + entry.endTimeOffset.nanos / 1e9;
      const duration = endTime - startTime; // Duration of the segment in the source

      // We actually need the 'source' start time and duration.
      // Wait, EditListEntry defines `startTimeOffset` and `endTimeOffset` usually as the range IN THE SOURCE file.
      // Let's verify interpretation.
      // "startTimeOffset": { "nanos": 991368664, "seconds": 52 } -> Start at 52.99s in source
      // "endTimeOffset": { "nanos": 525904176, "seconds": 75 } -> End at 75.52s in source

      const startSec =
        entry.startTimeOffset.seconds + entry.startTimeOffset.nanos / 1e9;
      const endSec =
        entry.endTimeOffset.seconds + entry.endTimeOffset.nanos / 1e9;

      // Video filter
      filterComplex.push(
        `[${inputIdx}:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS[v${segmentIndex}]`
      );
      // Audio filter
      filterComplex.push(
        `[${inputIdx}:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS[a${segmentIndex}]`
      );

      concatInputs.push(`[v${segmentIndex}][a${segmentIndex}]`);
      segmentIndex++;
    }

    // Add concat filter
    filterComplex.push(
      `${concatInputs.join('')}concat=n=${segmentIndex}:v=1:a=1[outv][outa]`
    );

    const outputFilename = `timeline_${payload.timelineId}_${Date.now()}.mp4`;
    const outputPath = path.join(tempDir, outputFilename);

    // Build FFmpeg arguments
    const args: string[] = [];

    // Add inputs
    for (const filePath of filePaths) {
      args.push('-i', filePath);
    }

    // Add complex filter
    args.push('-filter_complex', filterComplex.join(';'));

    // Map output
    args.push('-map', '[outv]', '-map', '[outa]');

    // Encoding settings
    // Default to h264/aac for compatibility if not specified or matching 'mp4'
    // Respect outputSettings
    if (outputSettings.codec === 'h265') {
      args.push('-c:v', 'libx265');
    } else {
      args.push('-c:v', 'libx264');
    }

    // TODO: Parse resolution and add scale filter if needed (would need to happen before concat or after?)
    // Easier to scale after concat: [outv]scale=1920:1080[outvscaled]
    // But mixed resolution inputs might fail concat.
    // Ideally, we scale ALL inputs to target resolution BEFORE concat.
    // Let's modify the loop to include scaling.

    // Audio encoding
    args.push('-c:a', 'aac', '-b:a', '128k');

    args.push('-y', outputPath);

    // Re-do filter generation with scaling to ensure consistent dims for concat
    // Parsing target resolution
    const [targetW, targetH] = outputSettings.resolution.split('x').map(Number);
    const width = targetW || 1920;
    const height = targetH || 1080;

    //Clear previous filter complex to rebuild correctly
    filterComplex.length = 0;
    concatInputs.length = 0;
    segmentIndex = 0;

    for (const entry of editList) {
      if (entry.inputs.length === 0) continue;
      const inputRef = entry.inputs[0];
      const inputIdx = inputMap.get(inputRef)!;

      const startSec =
        entry.startTimeOffset.seconds + entry.startTimeOffset.nanos / 1e9;
      const endSec =
        entry.endTimeOffset.seconds + entry.endTimeOffset.nanos / 1e9;

      // Scale and Trim
      // force_original_aspect_ratio=decrease,pad=... ensures we fit into the box without distortion
      const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

      filterComplex.push(
        `[${inputIdx}:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS,${scaleFilter},setsar=1[v${segmentIndex}]`
      );
      filterComplex.push(
        `[${inputIdx}:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS[a${segmentIndex}]`
      );

      concatInputs.push(`[v${segmentIndex}][a${segmentIndex}]`);
      segmentIndex++;
    }

    filterComplex.push(
      `${concatInputs.join('')}concat=n=${segmentIndex}:v=1:a=1[outv][outa]`
    );

    // Re-construct args with new filter
    args.length = 0;
    for (const filePath of filePaths) {
      args.push('-i', filePath);
    }
    args.push('-filter_complex', filterComplex.join(';'));
    args.push('-map', '[outv]', '-map', '[outa]');

    if (outputSettings.codec === 'h265') {
      args.push('-c:v', 'libx265', '-tag:v', 'hvc1');
    } else {
      args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
    }

    args.push('-c:a', 'aac', '-b:a', '128k');
    args.push('-movflags', '+faststart');
    args.push('-y', outputPath);

    try {
      console.log(`[FFmpegTimelineRenderer] Running ffmpeg with args:`, args);
      await execFileAsync('ffmpeg', args);
      console.log(`[FFmpegTimelineRenderer] Render completed: ${outputPath}`);
      return outputPath;
    } catch (error) {
      throw new Error(
        `FFmpeg timeline render failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
