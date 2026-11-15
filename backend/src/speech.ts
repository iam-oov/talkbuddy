import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { SEGMENT_SILENCE_MS, type LowWord, type SpeechSegment } from "./session";

const LOW_ACCURACY = 60;
const MAX_LOW_WORDS = 3;

interface AzureWord {
  Word?: string;
  PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
}

/** Picks the worst-scored words out of Azure's detailed JSON result. */
export function extractLowWords(json: string): LowWord[] {
  try {
    const wordsFound: AzureWord[] = JSON.parse(json)?.NBest?.[0]?.Words ?? [];
    return wordsFound
      .map((entry) => ({
        word: entry.Word ?? "",
        accuracy: entry.PronunciationAssessment?.AccuracyScore ?? 100,
        mispronounced: entry.PronunciationAssessment?.ErrorType === "Mispronunciation",
      }))
      .filter((entry) => entry.word && (entry.mispronounced || entry.accuracy < LOW_ACCURACY))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, MAX_LOW_WORDS)
      .map(({ word, accuracy }) => ({ word, accuracy }));
  } catch {
    return [];
  }
}

export interface SpeechStream {
  write(pcm: Buffer): void;
  close(): void;
}

/**
 * Continuous recognition over raw PCM16 16 kHz mono pushed from the phone.
 * With `pronunciation` on, each phrase also carries unscripted pronunciation scores.
 */
export function startSpeech(options: {
  key: string;
  region: string;
  pronunciation: boolean;
  onPartial: (text: string) => void;
  onFinal: (segment: SpeechSegment) => void;
  onError: (message: string) => void;
}): SpeechStream {
  const pushStream = sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1));
  const speechConfig = sdk.SpeechConfig.fromSubscription(options.key, options.region);
  speechConfig.speechRecognitionLanguage = "en-US";
  speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, String(SEGMENT_SILENCE_MS));
  const recognizer = new sdk.SpeechRecognizer(speechConfig, sdk.AudioConfig.fromStreamInput(pushStream));

  if (options.pronunciation) {
    // Empty reference text selects unscripted assessment: the learner speaks freely.
    new sdk.PronunciationAssessmentConfig(
      "",
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Word,
      false,
    ).applyTo(recognizer);
  }

  recognizer.recognizing = (_sender, event) => options.onPartial(event.result.text);
  recognizer.recognized = (_sender, event) => {
    if (event.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
    const json = event.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
    options.onFinal({ text: event.result.text, lowWords: options.pronunciation ? extractLowWords(json) : [] });
  };
  recognizer.canceled = (_sender, event) => {
    if (event.reason === sdk.CancellationReason.Error) options.onError(`Azure Speech: ${event.errorDetails}`);
  };
  recognizer.startContinuousRecognitionAsync(undefined, (error) => options.onError(`Azure Speech: ${error}`));

  return {
    write(pcm) {
      pushStream.write(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer);
    },
    close() {
      pushStream.close();
      recognizer.stopContinuousRecognitionAsync(
        () => recognizer.close(),
        () => recognizer.close(),
      );
    },
  };
}
