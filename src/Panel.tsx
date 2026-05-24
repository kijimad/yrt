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
  // Store video in a ref so mutations don't trigger react-hooks/immutability
  const videoRef = useRef(video);
  useEffect(() => { videoRef.current = video; }, [video]);

  // Keep refs in sync
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { loopingRef.current = looping; }, [looping]);
  useEffect(() => { repeatCountRef.current = repeatCount; }, [repeatCount]);

  const seekToCaption = useCallback((idx: number) => {
    const cap = captions[idx];
    if (cap === undefined) return;
    programmaticSeekRef.current = true;
    videoRef.current.currentTime = cap.start;
    seekedAtRef.current = Date.now();
    if (videoRef.current.paused) {
      void videoRef.current.play();
    }
  }, [captions]);

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
    return () => { document.removeEventListener('keydown', handleKeydown); };
  }, [goNext, goPrev, replay]);

  // Detect user seeks (seekbar) — sync to new position instead of looping back
  useEffect(() => {
    const v = videoRef.current;
    const onSeeking = (): void => {
      seekedAtRef.current = Date.now();
    };
    const onSeeked = (): void => {
      if (programmaticSeekRef.current) {
        programmaticSeekRef.current = false;
        return;
      }
      const time = v.currentTime;
      const newIdx = findCaptionIndex(captions, time);
      setCurrentIndex(newIdx);
      setRepeatCount(0);
    };
    v.addEventListener('seeking', onSeeking);
    v.addEventListener('seeked', onSeeked);
    return () => {
      v.removeEventListener('seeking', onSeeking);
      v.removeEventListener('seeked', onSeeked);
    };
  }, [captions, video]);

  // Playback polling
  useEffect(() => {
    const timer = setInterval(() => {
      if (captions.length === 0) return;
      if (Date.now() - seekedAtRef.current < 500) return;

      const time = videoRef.current.currentTime;
      const idx = currentIndexRef.current;
      const cap = captions[idx];
      if (cap === undefined) return;

      if (time >= cap.end - 0.05) {
        if (loopingRef.current) {
          const newCount = repeatCountRef.current + 1;
          setRepeatCount(newCount);
          programmaticSeekRef.current = true;
          seekedAtRef.current = Date.now();
          videoRef.current.currentTime = cap.start;
          return;
        }
        if (idx < captions.length - 1) {
          setCurrentIndex(idx + 1);
          setRepeatCount(0);
        }
        return;
      }

      if (time < cap.start || time >= cap.end) {
        const newIdx = findCaptionIndex(captions, time);
        if (newIdx !== idx) {
          setCurrentIndex(newIdx);
          setRepeatCount(0);
        }
      }
    }, 100);
    return () => { clearInterval(timer); };
  }, [captions, video]);

  // Dragging
  useEffect(() => {
    const el = panelRef.current;
    const header = el?.querySelector('[data-drag-handle]') as HTMLElement | null;
    if (el === null || header === null) return;

    let dragging = false;
    let startX = 0, startY = 0, origBottom = 0, origRight = 0;

    const onMouseDown = (e: MouseEvent): void => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      origBottom = window.innerHeight - rect.bottom;
      origRight = window.innerWidth - rect.right;
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (!dragging) return;
      el.style.bottom = String(origBottom - (e.clientY - startY)) + 'px';
      el.style.right = String(origRight - (e.clientX - startX)) + 'px';
      el.style.top = 'auto';
      el.style.left = 'auto';
    };

    const onMouseUp = (): void => { dragging = false; };

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
  const prevCap = currentIndex > 0 ? captions[currentIndex - 1] : undefined;
  const nextCap = currentIndex < captions.length - 1 ? captions[currentIndex + 1] : undefined;

  return (
    <ChakraProvider value={defaultSystem}>
      <Box
        ref={panelRef}
        id="yrt-panel"
        position="fixed"
        bottom="5rem"
        right="1.25rem"
        width={minimized ? '22rem' : '40rem'}
        bg="#ffffff"
        border="1px solid"
        borderColor="#d0d0d0"
        borderRadius="1rem"
        boxShadow="0 0.5rem 2rem rgba(0, 0, 0, 0.15)"
        zIndex={99999}
        fontFamily="'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        color="#1a1a1a"
        overflow="hidden"
      >
        {/* Header */}
        <Flex
          data-drag-handle
          justify="space-between"
          align="center"
          px="1.25rem"
          py="0.75rem"
          bg="#f5f5f5"
          cursor="grab"
          userSelect="none"
          borderBottom="1px solid"
          borderColor="#e0e0e0"
          _active={{ cursor: 'grabbing' }}
        >
          <Text fontSize="1rem" fontWeight="600" color="#555555" letterSpacing="0.05rem">
            Caption Repeater
          </Text>
          <HStack gap="0.5rem">
            <IconButton
              aria-label="Minimize"
              size="2xs"
              variant="ghost"
              color="#999999"
              _hover={{ bg: '#e0e0e0', color: '#333333' }}
              borderRadius="0.375rem"
              onClick={() => { setMinimized((m) => !m); }}
            >
              _
            </IconButton>
            <IconButton
              aria-label="Close"
              size="2xs"
              variant="ghost"
              color="#999999"
              _hover={{ bg: '#e0e0e0', color: '#333333' }}
              borderRadius="0.375rem"
              onClick={onClose}
            >
              x
            </IconButton>
          </HStack>
        </Flex>

        {/* Body */}
        {!minimized && (
          <VStack gap="0.75rem" p="1.25rem" align="stretch">
            {/* Status bar */}
            <Flex justify="space-between" fontSize="1rem" color="#999999" fontVariantNumeric="tabular-nums">
              <Text>{cap !== undefined ? `${String(currentIndex + 1)} / ${String(captions.length)}` : '-'}</Text>
              <Text>{cap !== undefined ? `${formatTime(cap.start)} - ${formatTime(cap.end)}` : '-'}</Text>
            </Flex>

            {/* Captions */}
            <Box bg="#fafafa" borderRadius="0.75rem" border="1px solid" borderColor="#e8e8e8" py="0.75rem">
              {prevCap !== undefined && (
                <Text px="1.25rem" py="0.375rem" fontSize="1.25rem" color="#aaaaaa" lineHeight="1.5" wordBreak="break-word">
                  {prevCap.text}
                </Text>
              )}
              {cap !== undefined && (
                <Text
                  px="1.25rem"
                  py="0.75rem"
                  fontSize="2.5rem"
                  color="#1a1a1a"
                  lineHeight="1.5"
                  wordBreak="break-word"
                  borderLeft="0.25rem solid"
                  borderColor="#e94560"
                >
                  {cap.text}
                </Text>
              )}
              {nextCap !== undefined && (
                <Text px="1.25rem" py="0.375rem" fontSize="1.25rem" color="#aaaaaa" lineHeight="1.5" wordBreak="break-word">
                  {nextCap.text}
                </Text>
              )}
            </Box>

            {/* Repeat indicator */}
            {looping && (
              <Text
                textAlign="center"
                py="0.5rem"
                color="#e94560"
                fontSize="1rem"
                fontWeight="600"
                letterSpacing="0.0625rem"
                animation="yrt-pulse 1.5s ease-in-out infinite"
              >
                &#x21BB; {repeatCount}
              </Text>
            )}

            {/* Nav controls */}
            <HStack gap="0.75rem">
              <Button
                flex={1}
                size="lg"
                py="1.25rem"
                bg="#f0f0f0"
                color="#333333"
                border="1px solid"
                borderColor="#d0d0d0"
                borderRadius="0.75rem"
                fontSize="1.25rem"
                _hover={{ bg: '#e0e0e0' }}
                _active={{ transform: 'scale(0.96)' }}
                _disabled={{ opacity: 0.3, cursor: 'not-allowed' }}
                disabled={currentIndex === 0}
                onClick={goPrev}
              >
                &laquo; Prev
              </Button>
              <Button
                flex={2}
                size="lg"
                py="1.25rem"
                bg="#e94560"
                color="#fff"
                fontWeight="600"
                fontSize="1.5rem"
                letterSpacing="0.05rem"
                borderRadius="0.75rem"
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
            <HStack gap="0.75rem">
              <Button
                flex={1}
                size="sm"
                py="0.625rem"
                bg="#f0f0f0"
                color="#666666"
                border="1px solid"
                borderColor="#d0d0d0"
                borderRadius="0.5rem"
                fontSize="1rem"
                _hover={{ bg: '#e0e0e0', color: '#333333' }}
                _active={{ transform: 'scale(0.96)' }}
                onClick={() => { setLooping((l) => !l); }}
              >
                Repeat: {looping ? 'ON' : 'OFF'}
              </Button>
              <Button
                flex={1}
                size="sm"
                py="0.625rem"
                bg="#f0f0f0"
                color="#666666"
                border="1px solid"
                borderColor="#d0d0d0"
                borderRadius="0.5rem"
                fontSize="1rem"
                _hover={{ bg: '#e0e0e0', color: '#333333' }}
                _active={{ transform: 'scale(0.96)' }}
                onClick={() => {
                  const newIdx = (speedIdx + 1) % speeds.length;
                  setSpeedIdx(newIdx);
                  videoRef.current.playbackRate = speeds[newIdx] ?? 1;
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
