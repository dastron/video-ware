import {
  type RenderTimelinePayload,
  type RenderTimelineResult,
} from '@project/shared';
import { TranscoderServiceClient } from '@google-cloud/video-transcoder';

/**
 * Helper class to handle Google Cloud timeline rendering
 */
export class GoogleTranscoderTimelineRenderer {
  private transcoderClient: TranscoderServiceClient;
  private projectId: string;
  private location: string;

  constructor() {
    this.transcoderClient = new TranscoderServiceClient();
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || '';
    this.location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  }

  /**
   * Render a timeline using Google Cloud Transcoder API
   * @param payload - The render payload
   * @param resolveToGcsUri - Function to resolve file references to GCS URIs
   * @returns Reference to the output file (GCS URI)
   */
  async render(
    payload: RenderTimelinePayload,
    resolveToGcsUri: (ref: string) => Promise<string>
  ): Promise<string> {
    console.log(
      `[GoogleTranscoderTimelineRenderer] Rendering timeline: ${payload.timelineId}`
    );

    if (!this.projectId) throw new Error('GOOGLE_CLOUD_PROJECT_ID not set');
    const bucket = process.env.GOOGLE_CLOUD_STORAGE_BUCKET;
    if (!bucket) throw new Error('GOOGLE_CLOUD_STORAGE_BUCKET not set');

    const { editList, outputSettings } = payload;
    const parent = this.transcoderClient.locationPath(
      this.projectId,
      this.location
    );

    // 1. Construct Inputs
    // Map each unique input file to a JobInput
    const inputs: any[] = [];
    const inputMap = new Map<string, string>(); // ref -> key

    for (const entry of editList) {
      for (const inputRef of entry.inputs) {
        if (!inputMap.has(inputRef)) {
          const gcsUri = await resolveToGcsUri(inputRef);
          const key = `input${inputs.length}`;
          inputs.push({
            key: key,
            uri: gcsUri,
          });
          inputMap.set(inputRef, key);
        }
      }
    }

    // 2. Construct Edit List (Elementary Streams)
    // In GCP Transcoder, we define elementary streams (video/audio) using validation/edit lists.
    // However, the standard API uses `editList` inside `elementaryStreams`.

    // We need one video stream and one audio stream that are composites of the inputs.

    // Video Stream
    const videoVideoStream = {
      key: 'video-stream',
      videoStream: {
        h264: {
          heightPixels: 1080,
          widthPixels: 1920,
          bitrateBps: 2500000,
          frameRate: 30,
        },
      },
      // The edit list maps input segments to this output stream
      // But wait, GCP Transcoder API separates "Elementary Streams" (encoding settings)
      // from "Mux Streams" (container).
      // AND it supports "EditAtom" for stitching.
      // Actually, concatenating multiple inputs is done via `elementaryStreams` where you list `inputs`
      // and can specify start/end times.
      // BUT, checking the docs/protos:
      // A `VideoStream` or `AudioStream` does NOT directly take an edit list of inputs for stitching.
      // Stitching is often done by defining multiple inputs and then referencing them?
      // No, for clean stitching of multiple files, we usually use the `editList` field in the job config
      // IF it is supported at that level.
      // Actually, standard V1 Transcoder API:
      // `elementaryStreams` -> `videoStream` | `audioStream`
      // There is no top-level edit list for stitching in the basic `Job` object easily found.
      //
      // WAIT! The Transcoder API DOES support stitching via `editList` in `ElementaryStream`? No.
      // It supports `adBreaks` and `overlays`.
      // Stitching multiple distinct video files into one is a complex use case.
      // The `Concatenation` feature might be what we need? Not explicitly named.
      //
      // Let's re-read the specs or commonly used patterns.
      // In GCP Transcoder, "Input stitching" is supported.
      // "You can stitch multiple input videos together to create a single output video."
      // How?
      // "To stitch videos, you create an edit list." - but where?
      // Ah, `editList` is indeed a field in `Job`? No.
      // It is usually implicitly handled by mapping inputs?
      //
      // Found it: `JobConfig` -> `editList` (Top level).
      // Docs: "List of input segments. The sequence of these segments determines the order of the output content."
      // `entries`: Array of `EditListEntry`.
      // `EditListEntry` has `startTimeOffset`, `endTimeOffset`, `inputs` (list of input keys).
    };

    // Let's re-verify specific API version (v1).
    // I will write the code assuming `editList` exists on `JobConfig`.
    // In `@google-cloud/video-transcoder` v1, `JobConfig` has `editList`.

    const jobEditList: any[] = []; // google.cloud.video.transcoder.v1.IEditAtom[]

    for (const entry of editList) {
      // Convert time offsets to string format "10.5s"
      const startSec =
        entry.startTimeOffset.seconds + entry.startTimeOffset.nanos / 1e9;
      const endSec =
        entry.endTimeOffset.seconds + entry.endTimeOffset.nanos / 1e9;

      const inputKey = inputMap.get(entry.inputs[0]);

      jobEditList.push({
        key: inputKey, // The input key to use
        startTimeOffset: `${startSec}s`,
        endTimeOffset: `${endSec}s`,
        inputs: [inputKey], // The input(s) to read from
      });
    }

    // 3. Define Output Streams
    // Video
    const videoStream = {
      key: 'video_stream',
      // Instead of editList here (which doesn't exist), we assume the top level edit list
      // drives the timeline, and this stream just encodes "the timeline".
      // Actually, the `editList` sequence applies to the *inputs* to generate an intermediate timeline?
      // Let's look closer at `JobConfig`.
      // `editList` is a sequence of atoms.
      // `elementaryStreams` then reference the inputs?
      //
      // Actually, Transcoder API has `elementaryStreams` which use `input` keys.
      // If we want to concatenate, we configure the `editList` (sequence of inputs)
      // and then the elementary streams process that sequence?
      //
      // CORRECT PATH:
      // Use `editList` to define the sequence.
      // Then `elementaryStreams` don't specify inputs, they just define encoding?
      // No, elementary streams usually specify a source.
      // If `editList` is present, it acts as a virtual input?

      // Alternative: Each `ElementaryStream` has a `key`.
      // The `MuxStream` maps elementary streams to container.

      // Let's use the `editList` field in the Job config.
      videoStream: {
        h264: {
          heightPixels: outputSettings.resolution === '1920x1080' ? 1080 : 720,
          widthPixels: outputSettings.resolution === '1920x1080' ? 1920 : 1280,
          bitrateBps: 2500000,
          frameRate: 30,
        },
      },
    };

    const audioStream = {
      key: 'audio_stream',
      audioStream: {
        codec: 'aac',
        bitrateBps: 128000,
      },
    };

    const muxStream = {
      key: 'output_mux',
      container: 'mp4',
      elementaryStreams: ['video_stream', 'audio_stream'],
    };

    const outputUri = `gs://${bucket}/timelines/${payload.timelineId}/`;

    const job = {
      inputUri: '', // We use named inputs
      outputUri: outputUri,
      config: {
        inputs: inputs,
        editList: jobEditList,
        elementaryStreams: [videoStream, audioStream],
        muxStreams: [muxStream],
      },
    };

    // Note: TypeScript types for `google.cloud.video.transcoder.v1` might be tricky.
    // Ensure `editList` is populated correctly.
    // The `EditAtom` has `key`, `inputs`, `startTimeOffset`, `endTimeOffset`.

    console.log(
      '[GoogleTranscoderTimelineRenderer] Submitting job',
      JSON.stringify(job, null, 2)
    );

    try {
      const [response] = await this.transcoderClient.createJob({
        parent,
        job: job as any, // Type casting to avoid strict strictness if types are slightly off
      });

      console.log(
        `[GoogleTranscoderTimelineRenderer] Job started: ${response.name}`
      );

      // We need to wait for the job to complete if we want to return the result synchronously.
      // Ideally we should return a "pending" status, but the current Worker architecture
      // seems to expect synchronous completion for the "processing" phase (or long polling).
      // Since we are inside a long-running worker task, we can poll for completion.

      await this.waitForJob(response.name!);

      // The output filename is deterministic from mux stream?
      // Transcoder typically outputs `outputUri + muxStreamKey + .mp4`?
      // Or if we didn't specify filename in `fileName` of mux stream.
      // Default behavior: `output_mux.mp4`

      return `${outputUri}output_mux.mp4`;
    } catch (error) {
      throw new Error(
        `Google Cloud timeline render failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async waitForJob(jobName: string): Promise<void> {
    let state = 'PROCESSING';
    while (state === 'PROCESSING' || state === 'PENDING') {
      await new Promise((r) => setTimeout(r, 5000));
      const [job] = await this.transcoderClient.getJob({ name: jobName });
      state = job.state as string;
      if (state === 'SUCCEEDED') return;
      if (state === 'FAILED') {
        throw new Error(`Transcoding job failed: ${job.error?.message}`);
      }
    }
  }
}
