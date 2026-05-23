export interface RequestCaptions {
  type: 'yrt-request-captions';
}

export interface CaptionTracksResponse {
  type: 'yrt-caption-tracks';
  tracks: CaptionTrack[];
  xml: string;
}

export interface CaptionTrack {
  kind: string;
  baseUrl: string;
}

export type YrtMessage = RequestCaptions | CaptionTracksResponse;

export function isYrtMessage(data: unknown): data is YrtMessage {
  return typeof data === 'object' && data !== null && 'type' in data
    && typeof (data as YrtMessage).type === 'string'
    && (data as YrtMessage).type.startsWith('yrt-');
}
