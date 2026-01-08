# Fix: Media Record Creation Schema Mismatch

## Problem

The transcode service was failing to create media records with the following Zod validation error:

```
ZodError: [
  {
    "expected": "'video' | 'audio' | 'image'",
    "received": "undefined",
    "code": "invalid_type",
    "path": ["mediaType"],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "object",
    "received": "undefined",
    "path": ["mediaData"],
    "message": "Required"
  }
]
```

## Root Cause

The `createOrUpdateMediaRecord` method in `transcode.service.ts` was creating a flat object structure that didn't match the Media schema defined in `shared/src/schema/media.ts`.

**Expected Schema:**
```typescript
{
  WorkspaceRef: string,
  UploadRef: string,
  mediaType: 'video' | 'audio' | 'image',  // Required enum
  duration: number,                         // Required
  mediaData: object,                        // Required JSON object
  thumbnailFileRef?: string,
  spriteFileRef?: string,
  proxyFileRef?: string,
  version: number
}
```

**What was being sent:**
```typescript
{
  name: string,
  type: string,        // Wrong field name! Should be 'mediaType'
  duration: number,
  width: number,       // Should be nested in 'mediaData'
  height: number,      // Should be nested in 'mediaData'
  fps: number,         // Should be nested in 'mediaData'
  // ... more flat fields that should be in mediaData
  WorkspaceRef: string,
  // Missing: UploadRef, mediaType, mediaData
}
```

## Solution

### 1. Restructured Media Data Object

Changed from flat structure to nested structure matching the schema:

```typescript
const mediaData = {
  WorkspaceRef: upload.WorkspaceRef,
  UploadRef: upload.id,                    // Added
  mediaType,                                // Renamed from 'type'
  duration: result.probeOutput.duration || 0,
  mediaData: {                              // Nested all metadata
    name: upload.name || `Media ${upload.id}`,
    width: result.probeOutput.width,
    height: result.probeOutput.height,
    fps: result.probeOutput.fps,
    codec: result.probeOutput.codec,
    bitrate: result.probeOutput.bitrate,
    size: result.probeOutput.size,
    probeOutput: result.probeOutput,
    processorVersion,
  },
  thumbnailFileRef: fileRecords.thumbnail.id,
  spriteFileRef: fileRecords.sprite.id,
  proxyFileRef: fileRecords.proxy?.id || undefined,
  version: 1,
};
```

### 2. Fixed Media Type Enum

Changed `determineMediaType` to return proper `MediaType` enum values:

**Before:**
```typescript
private determineMediaType(probeOutput: any): string {
  if (probeOutput.width && probeOutput.height) {
    return 'video';  // String literal
  }
  if (probeOutput.duration && !probeOutput.width && !probeOutput.height) {
    return 'audio';  // String literal
  }
  return 'unknown';  // Invalid value!
}
```

**After:**
```typescript
private determineMediaType(probeOutput: any): MediaType {
  if (probeOutput.width && probeOutput.height) {
    return MediaType.VIDEO;  // Proper enum
  }
  if (probeOutput.duration && !probeOutput.width && !probeOutput.height) {
    return MediaType.AUDIO;  // Proper enum
  }
  return MediaType.VIDEO;  // Valid default
}
```

### 3. Simplified Media Creation

Changed from using `createOrUpdateMedia` helper (which added extra wrapping) to directly using the mutator:

**Before:**
```typescript
return await this.pocketbaseService.createOrUpdateMedia(upload.id, mediaData);
```

**After:**
```typescript
return await this.pocketbaseService.mediaMutator.create(mediaData);
```

## Files Modified

- `worker/src/transcode/transcode.service.ts`
  - Updated `createOrUpdateMediaRecord` method (lines 256-294)
  - Updated `determineMediaType` method (lines 296-310)
  - Added `MediaType` import (line 8)

## Testing

To verify the fix works:

1. Upload a new video file
2. Monitor the worker logs - should see successful media record creation
3. Check PocketBase - media record should exist with proper `mediaType` and `mediaData` fields

## Related Issues

This fix ensures the worker correctly populates the Media collection with data that can be consumed by the frontend for displaying video metadata, thumbnails, and playback controls.

