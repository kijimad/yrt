import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ChakraProvider,
  defaultSystem,
  Box,
  Flex,
  Text,
  Button,
  IconButton,
  HStack,
  VStack,
} from '@chakra-ui/react';
import type { Caption } from './captions.ts';
import { formatTime, findCaptionIndex } from './captions.ts';

interface PanelProps {
  captions: Caption[];
  initialIndex: number;
  video: HTMLVideoElement;
  onClose: () => void;
}

export function Panel({ captions, initialIndex, video, onClose }: PanelProps): React.JSX.Element {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [looping, setLooping] = useState(true);
  const [repeatCount, setRepeatCount] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const speeds = [1, 0.75, 0.5, 0.25] as const;

  const panelRef = useRef<HTMLDivElement>(null);
  const seekedAtRef = useRef(0);
  const programmaticSeekRef = useRef(false);
  const currentIndexRef = useRef(currentIndex);
  const loopingRef = useRef(looping);
  const repeatCountRef = useRef(repeatCount);

  // Keep refs in sync
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { loopingRef.current = looping; }, [looping]);
  useEffect(() => { repeatCountRef.current = repeatCount; }, [repeatCount]);

  const seekToCaption = useCallback((idx: number) => {
    const cap = captions[idx];
    if (!cap) return;
    programmaticSeekRef.current = true;
    video.currentTime = cap.start;
    seekedAtRef.current = Date.now();
    if (video.paused) void video.play();
  }, [captions, video]);

  const goNext = useCallback(() => {
    setCurrentIndex((prev) => {
      if (prev < captions.length - 1) {
        const next = prev + 1;
        setRepeatCount(0);
        seekToCaption(next);
        return next;
      }
      return prev;
    });
  }, [captions.length, seekToCaption]);

  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => {
      if (prev > 0) {
        const next = prev - 1;
        setRepeatCount(0);
        seekToCaption(next);
        return next;
      }
      return prev;
    });
  }, [seekToCaption]);

  const replay = useCallback(() => {
    seekToCaption(currentIndexRef.current);
  }, [seekToCaption]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if (e.key === 'ArrowRight' && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        goNext();
      } else if (e.key === 'ArrowLeft' && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        goPrev();
      } else if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        replay();
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [goNext, goPrev, replay]);

  // Detect user seeks (seekbar) — sync to new position instead of looping back
  useEffect(() => {
    const onSeeking = () => {
      seekedAtRef.current = Date.now();
    };
    const onSeeked = () => {
      // Skip resync for programmatic seeks (goNext/goPrev/loop)
      if (programmaticSeekRef.current) {
        programmaticSeekRef.current = false;
        return;
      }
      // After user seek completes, sync to the new caption
      const time = video.currentTime;
      const newIdx = findCaptionIndex(captions, time);
      setCurrentIndex(newIdx);
      setRepeatCount(0);
    };
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    return () => {
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [captions, video]);

  // Playback polling
  useEffect(() => {
    const timer = setInterval(() => {
      if (captions.length === 0) return;
      // Skip polling briefly after any seek (user or programmatic)
      if (Date.now() - seekedAtRef.current < 500) return;

      const time = video.currentTime;
      const idx = currentIndexRef.current;
      const cap = captions[idx];
      if (!cap) return;

      if (time >= cap.end - 0.05) {
        if (loopingRef.current) {
          const newCount = repeatCountRef.current + 1;
          setRepeatCount(newCount);
          programmaticSeekRef.current = true;
          seekedAtRef.current = Date.now();
          video.currentTime = cap.start;
          return;
        }
        if (idx < captions.length - 1) {
          setCurrentIndex(idx + 1);
          setRepeatCount(0);
        }
        return;
      }

      if (time < cap.start || time >= cap.end) {
        // Find matching caption
        const newIdx = findCaptionIndex(captions, time);
        if (newIdx !== idx) {
          setCurrentIndex(newIdx);
          setRepeatCount(0);
        }
      }
    }, 100);
    return () => clearInterval(timer);
  }, [captions, video]);

  // Dragging
  useEffect(() => {
    const el = panelRef.current;
    const header = el?.querySelector('[data-drag-handle]') as HTMLElement | null;
    if (!el || !header) return;

    let dragging = false;
    let startX = 0, startY = 0, origX = 0, origY = 0;

    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      el.style.left = origX + (e.clientX - startX) + 'px';
      el.style.top = origY + (e.clientY - startY) + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };

    const onMouseUp = () => { dragging = false; };

    header.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      header.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const cap = captions[currentIndex];
  const prevCap = currentIndex > 0 ? captions[currentIndex - 1] : null;
  const nextCap = currentIndex < captions.length - 1 ? captions[currentIndex + 1] : null;

  return (
    <ChakraProvider value={defaultSystem}>
      <Box
        ref={panelRef}
        id="yrt-panel"
        position="fixed"
        bottom="80px"
        right="20px"
        width={minimized ? '180px' : '480px'}
        bg="#1a1a2e"
        border="1px solid"
        borderColor="#3a3a5c"
        borderRadius="12px"
        boxShadow="0 8px 32px rgba(0, 0, 0, 0.5)"
        zIndex={99999}
        fontFamily="'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        color="#e0e0e0"
        overflow="hidden"
      >
        {/* Header */}
        <Flex
          data-drag-handle
          justify="space-between"
          align="center"
          px="12px"
          py="8px"
          bg="#16213e"
          cursor="grab"
          userSelect="none"
          borderBottom="1px solid"
          borderColor="#3a3a5c"
          _active={{ cursor: 'grabbing' }}
        >
          <Text fontSize="12px" fontWeight="600" color="#a8b2d1" letterSpacing="0.5px">
            Caption Repeater
          </Text>
          <HStack gap="4px">
            <IconButton
              aria-label="Minimize"
              size="2xs"
              variant="ghost"
              color="#6c7aa0"
              _hover={{ bg: '#3a3a5c', color: '#e0e0e0' }}
              borderRadius="4px"
              onClick={() => setMinimized((m) => !m)}
            >
              _
            </IconButton>
            <IconButton
              aria-label="Close"
              size="2xs"
              variant="ghost"
              color="#6c7aa0"
              _hover={{ bg: '#3a3a5c', color: '#e0e0e0' }}
              borderRadius="4px"
              onClick={onClose}
            >
              x
            </IconButton>
          </HStack>
        </Flex>

        {/* Body */}
        {!minimized && (
          <VStack gap="6px" p="10px" align="stretch">
            {/* Status bar */}
            <Flex justify="space-between" fontSize="11px" color="#6c7aa0" fontVariantNumeric="tabular-nums">
              <Text>{cap ? `${currentIndex + 1} / ${captions.length}` : '-'}</Text>
              <Text>{cap ? `${formatTime(cap.start)} - ${formatTime(cap.end)}` : '-'}</Text>
            </Flex>

            {/* Captions */}
            <Box bg="#0f0f23" borderRadius="6px" border="1px solid" borderColor="#2a2a4a" py="6px">
              {prevCap && (
                <Text px="12px" py="4px" fontSize="14px" color="#555a70" lineHeight="1.5" wordBreak="break-word">
                  {prevCap.text}
                </Text>
              )}
              {cap && (
                <Text
                  px="12px"
                  py="8px"
                  fontSize="32px"
                  color="#f0f0f0"
                  lineHeight="1.5"
                  wordBreak="break-word"
                  borderLeft="3px solid"
                  borderColor="#e94560"
                >
                  {cap.text}
                </Text>
              )}
              {nextCap && (
                <Text px="12px" py="4px" fontSize="14px" color="#555a70" lineHeight="1.5" wordBreak="break-word">
                  {nextCap.text}
                </Text>
              )}
            </Box>

            {/* Repeat indicator */}
            {looping && (
              <Text
                textAlign="center"
                py="4px"
                color="#e94560"
                fontSize="11px"
                fontWeight="600"
                letterSpacing="1px"
                animation="yrt-pulse 1.5s ease-in-out infinite"
              >
                &#x21BB; {repeatCount}
              </Text>
            )}

            {/* Nav controls */}
            <HStack gap="6px">
              <Button
                flex={1}
                size="sm"
                py="8px"
                bg="#1a1a40"
                color="#a8b2d1"
                border="1px solid"
                borderColor="#3a3a5c"
                borderRadius="6px"
                fontSize="12px"
                _hover={{ bg: '#2a2a50' }}
                _active={{ transform: 'scale(0.96)' }}
                _disabled={{ opacity: 0.3, cursor: 'not-allowed' }}
                disabled={currentIndex === 0}
                onClick={goPrev}
              >
                &laquo; Prev
              </Button>
              <Button
                flex={2}
                size="sm"
                py="8px"
                bg="#e94560"
                color="#fff"
                fontWeight="600"
                fontSize="13px"
                letterSpacing="0.5px"
                borderRadius="6px"
                _hover={{ bg: '#ff6b81' }}
                _active={{ transform: 'scale(0.96)' }}
                _disabled={{ opacity: 0.3, cursor: 'not-allowed' }}
                disabled={currentIndex === captions.length - 1}
                onClick={goNext}
              >
                Next &raquo;
              </Button>
            </HStack>

            {/* Secondary controls */}
            <HStack gap="6px">
              <Button
                flex={1}
                size="sm"
                py="6px"
                bg="#1a1a40"
                color="#6c7aa0"
                border="1px solid"
                borderColor="#2a2a4a"
                borderRadius="6px"
                fontSize="11px"
                _hover={{ bg: '#2a2a50', color: '#a8b2d1' }}
                _active={{ transform: 'scale(0.96)' }}
                onClick={() => setLooping((l) => !l)}
              >
                Repeat: {looping ? 'ON' : 'OFF'}
              </Button>
              <Button
                flex={1}
                size="sm"
                py="6px"
                bg="#1a1a40"
                color="#6c7aa0"
                border="1px solid"
                borderColor="#2a2a4a"
                borderRadius="6px"
                fontSize="11px"
                _hover={{ bg: '#2a2a50', color: '#a8b2d1' }}
                _active={{ transform: 'scale(0.96)' }}
                onClick={() => {
                  const newIdx = (speedIdx + 1) % speeds.length;
                  setSpeedIdx(newIdx);
                  video.playbackRate = speeds[newIdx] ?? 1;
                }}
              >
                {speeds[speedIdx]}x
              </Button>
            </HStack>
          </VStack>
        )}
      </Box>

      {/* Pulse animation - injected as a style tag */}
      <style>{`
        @keyframes yrt-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </ChakraProvider>
  );
}
