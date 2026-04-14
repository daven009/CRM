import { useState, useRef, useCallback, useEffect } from "react";
import {
  transcribeAudio,
  hasTranscribeApiKey,
  getSupportedMimeType,
  isRecordingSupported,
  buildSTTPrompt,
} from "../lib/models/openaiTranscribe";

/**
 * 录音状态
 */
const VOICE_STATES = {
  IDLE: "idle",
  RECORDING: "recording",
  PROCESSING: "processing",
  TRANSCRIBING: "transcribing",
  ERROR: "error",
};

/**
 * 语音录制 + STT 自定义 Hook
 *
 * @param {Object} options
 * @param {Function} options.onResult - 转录成功回调 (text: string) => void
 * @param {Function} [options.onError] - 错误回调 (error: string) => void
 * @param {string} [options.promptHint] - 注入 STT 的 prompt（客户名列表等）
 * @param {number} [options.maxDuration=60] - 最大录音时长（秒）
 * @returns {{
 *   state: string,
 *   duration: number,
 *   error: string | null,
 *   isSupported: boolean,
 *   startRecording: () => void,
 *   stopRecording: () => void,
 *   cancelRecording: () => void,
 * }}
 */
export function useVoiceRecorder({
  onResult,
  onError,
  promptHint = "",
  maxDuration = 60,
} = {}) {
  const [state, setState] = useState(VOICE_STATES.IDLE);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const durationTimerRef = useRef(null);
  const maxTimerRef = useRef(null);
  const startTimeRef = useRef(null);

  // 存放最新的 callbacks，避免闭包陈旧
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const promptHintRef = useRef(promptHint);
  promptHintRef.current = promptHint;

  const isSupported = isRecordingSupported();

  /**
   * 清理所有资源
   */
  const cleanup = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    startTimeRef.current = null;
  }, []);

  /**
   * 处理录音完成后的 STT 转录
   */
  const handleTranscribe = useCallback(
    async (audioBlob) => {
      if (!audioBlob || audioBlob.size === 0) {
        setState(VOICE_STATES.IDLE);
        setDuration(0);
        cleanup();
        return;
      }

      // 录音时长太短（< 0.5s），忽略
      const elapsed = startTimeRef.current
        ? (Date.now() - startTimeRef.current) / 1000
        : 0;
      if (elapsed < 0.5) {
        setState(VOICE_STATES.IDLE);
        setDuration(0);
        cleanup();
        return;
      }

      setState(VOICE_STATES.TRANSCRIBING);

      try {
        if (hasTranscribeApiKey()) {
          const result = await transcribeAudio(audioBlob, {
            prompt: promptHintRef.current,
          });
          const text = result.text;
          if (text) {
            onResultRef.current?.(text);
          }
        } else {
          // 无 API Key 降级提示
          const errMsg = "未配置 OpenAI API Key，无法使用语音转文字";
          setError(errMsg);
          onErrorRef.current?.(errMsg);
          setState(VOICE_STATES.ERROR);
          setTimeout(() => {
            setState(VOICE_STATES.IDLE);
            setError(null);
          }, 3000);
          cleanup();
          return;
        }

        setState(VOICE_STATES.IDLE);
        setError(null);
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : "语音转文字失败";
        setError(errMsg);
        onErrorRef.current?.(errMsg);
        setState(VOICE_STATES.ERROR);
        // 3 秒后自动恢复 idle
        setTimeout(() => {
          setState(VOICE_STATES.IDLE);
          setError(null);
        }, 3000);
      } finally {
        setDuration(0);
        cleanup();
      }
    },
    [cleanup]
  );

  /**
   * 开始录音
   */
  const startRecording = useCallback(async () => {
    if (state !== VOICE_STATES.IDLE && state !== VOICE_STATES.ERROR) return;
    if (!isSupported) return;

    setError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;

      const mimeType = getSupportedMimeType();
      const options = mimeType ? { mimeType } : {};
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        setState(VOICE_STATES.PROCESSING);
        const chunks = audioChunksRef.current;
        if (chunks.length === 0) {
          setState(VOICE_STATES.IDLE);
          setDuration(0);
          cleanup();
          return;
        }
        const finalMime = mimeType || recorder.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: finalMime });
        handleTranscribe(blob);
      };

      recorder.onerror = (e) => {
        const errMsg = `录音错误: ${e.error?.name || "unknown"}`;
        setError(errMsg);
        onErrorRef.current?.(errMsg);
        setState(VOICE_STATES.ERROR);
        setTimeout(() => {
          setState(VOICE_STATES.IDLE);
          setError(null);
        }, 3000);
        cleanup();
      };

      recorder.start(250); // 每 250ms 收集一次数据
      startTimeRef.current = Date.now();
      setState(VOICE_STATES.RECORDING);
      setDuration(0);

      // 实时更新录音时长
      durationTimerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 500);

      // 最大时长保护
      maxTimerRef.current = setTimeout(() => {
        if (
          mediaRecorderRef.current &&
          mediaRecorderRef.current.state === "recording"
        ) {
          mediaRecorderRef.current.stop();
        }
      }, maxDuration * 1000);
    } catch (err) {
      let errMsg = "麦克风权限被拒绝";
      if (err instanceof Error) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          errMsg = "请允许麦克风权限以使用语音功能";
        } else if (err.name === "NotFoundError") {
          errMsg = "未检测到麦克风设备";
        } else {
          errMsg = err.message;
        }
      }
      setError(errMsg);
      onErrorRef.current?.(errMsg);
      setState(VOICE_STATES.ERROR);
      setTimeout(() => {
        setState(VOICE_STATES.IDLE);
        setError(null);
      }, 3000);
      cleanup();
    }
  }, [state, isSupported, maxDuration, cleanup, handleTranscribe]);

  /**
   * 停止录音（触发 STT）
   */
  const stopRecording = useCallback(() => {
    if (state !== VOICE_STATES.RECORDING) return;

    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
    // stream 在 onstop handler 之后 cleanup
  }, [state]);

  /**
   * 取消录音（不触发 STT）
   */
  const cancelRecording = useCallback(() => {
    if (state !== VOICE_STATES.RECORDING) return;

    // 先取消 onstop handler
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    }

    setState(VOICE_STATES.IDLE);
    setDuration(0);
    setError(null);
    cleanup();
  }, [state, cleanup]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    state,
    duration,
    error,
    isSupported,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}

/**
 * 格式化录音时长
 * @param {number} seconds
 * @returns {string} "0:05", "1:23"
 */
export function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export { VOICE_STATES };
