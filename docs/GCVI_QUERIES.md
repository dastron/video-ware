# New Entities:

1) LabelEntity (catalog / dictionary)

Why: You’ll want a stable “thing” separate from each occurrence. This prevents re-storing label strings/taxonomy everywhere and makes search/analytics easier.

When used: all label types (OBJECT/SHOT/PERSON/SPEECH), but especially OBJECT/PERSON.

Core fields

WorkspaceRef
labelType (OBJECT/SHOT/PERSON/SPEECH)
canonicalName (e.g. "Car", "Person", "Interview")
provider (GOOGLE_VIDEO_INTELLIGENCE / GOOGLE_SPEECH)
processor (string)


2) LabelTrack (track-level, sparse time series)

Why: Object/person/face detection often forms tracks. A clip is “a snippet”; a track is “the same instance over time”.

When used: OBJECT and PERSON (and optionally FACE as PERSON subtype).

Core fields

WorkspaceRef, MediaRef, TaskRef
LabelEntityRef
trackId (stable within a processing run)
start, end, duration
confidence (avg/max + optional stats JSON)
provider, processor, version
trackData (JSON: aggregated properties—e.g. class, attributes)
keyframes (JSON array: {t, bbox, confidence})

How it relates to LabelClip:
A LabelClip for an object could represent a subspan that’s “useful”.
The LabelTrack is the full track; LabelClip points to it when relevant

# Summary of Google Cloud Queries

1. LabelDetectionVideoIntelligenceTask
Features: LABEL_DETECTION, SHOT_CHANGE_DETECTION
Mode: SHOT_MODE (with videoConfidenceThreshold: 0.2)

2. ObjectTrackingVideoIntelligenceTask
Features: OBJECT_TRACKING

3. FaceDetectionVideoIntelligenceTask
Features: FACE_DETECTION
Config: bounding boxes + attributes enabled

4. PersonDetectionVideoIntelligenceTask
Features: PERSON_DETECTION
Config: bounding boxes + pose landmarks + attributes enabled

5. SpeechTranscriptionVideoIntelligenceTask
Features: SPEECH_TRANSCRIPTION
Config: languageCode: 'en-US', automatic punctuation enabled

---

## 1) `LabelDetectionVideoIntelligenceTask`

### setJobConfig

```js
{
  features: ['LABEL_DETECTION', 'SHOT_CHANGE_DETECTION'],
  videoContext: {
    labelDetectionConfig: {
      labelDetectionMode: 'SHOT_MODE',
      videoConfidenceThreshold: 0.2
    }
  }
}
```

### Tables created (JSONL written to storage) + loaded to BigQuery

* `gcvi_detect_video_segment*`
* `gcvi_label_video_segment*`
* `gcvi_detect_shot_segment*`
* `gcvi_label_shot_segment*`

## Data Types

1. **DetectVideoSegment**

* Input key: `results.segment`
* Line in code: `const segment = results?.segment ?? []`

2. **LabelVideoSegment**

* Input key: `results.segment_label_annotations`
* Line: `const segmentLabelAnnotations = results?.segment_label_annotations ?? []`

3. **DetectShotSegment**

* Input key: `results.shot_annotations`
* Line: `const shotAnnotations = results?.shot_annotations ?? []`

4. **LabelShotSegment**

* Input key: `results.shot_label_annotations`
* Line: `const shotLabelAnnotations = results?.shot_label_annotations ?? []`


---

## 2) `ObjectTrackingVideoIntelligenceTask`

### setJobConfig

```js
{
  features: ['OBJECT_TRACKING']
}
```

### Tables created + loaded

* `gcvi_object_tracking_frame*` (name in code: `tableObjectTrackingFrame`)

## Data Types

1. **ObjectTrackingFrame**

* Input key: `results.object_annotations`
* Line: `const objectAnnotations = results?.object_annotations ?? []`

---

## 3) `FaceDetectionVideoIntelligenceTask`

### setJobConfig

```js
{
  features: ['FACE_DETECTION'],
  videoContext: {
    faceDetectionConfig: {
      includeBoundingBoxes: true,
      includeAttributes: true
    }
  }
}
```

### Tables created + loaded

* `gcvi_detect_face_segment*`
* `gcvi_face_tracking_frame*`

## Data Types

* Input key: `results.face_detection_annotations`
* Line: `const faceDetectionAnnotations = results?.face_detection_annotations ?? []`

---

## 4) `PersonDetectionVideoIntelligenceTask`

### setJobConfig

```js
{
  features: ['PERSON_DETECTION'],
  videoContext: {
    personDetectionConfig: {
      includeBoundingBoxes: true,
      includePoseLandmarks: true,
      includeAttributes: true
    }
  }
}
```

### Tables created + loaded

* `gcvi_detect_person_segment*`
* `gcvi_person_tracking_frame*`
* `gcvi_person_landmark_tracking*`

## Data Types

* Input key: `results.person_detection_annotations`
* Line: `const personDetectionAnnotations = results?.person_detection_annotations ?? []`

Used three ways:

1. **DetectPersonSegment** from `results.person_detection_annotations`
2. **PersonTrackingFrame** from `results.person_detection_annotations`
3. **PersonLandmarkTrackingFrame** from `results.person_detection_annotations`

---

## 5) `SpeechTranscriptionVideoIntelligenceTask`

### setJobConfig

```js
{
  features: ['SPEECH_TRANSCRIPTION'],
  videoContext: {
    speechTranscriptionConfig: {
      languageCode: 'en-US',
      enableAutomaticPunctuation: true
    }
  }
}
```

### Tables created + loaded

* `TABLE_NAMES.SPEECH_TRANSCRIPTION` → `gcvi_speech_transcription*`

## Data Types

Consumes:

* Input key path: `results.speech_transcriptions?.[0]`
* Line: `const speechTranscriptionWords = results?.speech_transcriptions?.[0] ?? []`

---