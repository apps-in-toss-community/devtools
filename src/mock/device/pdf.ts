/**
 * PDF Viewer mock
 * 네이티브 PDF 뷰어 동작을 시뮬레이션한다.
 * 권한 게이트 없음. 모드 분기 없음.
 */

export interface OpenPDFViewerParams {
  data: string;
  filename?: string;
}

export type OpenPDFViewerResult = 'CLOSE';

/**
 * Base64로 인코딩된 PDF 데이터를 네이티브 PDF 뷰어로 여는 mock.
 * mock 환경에서는 즉시 `'CLOSE'`를 반환한다.
 */
const _openPDFViewerImpl = async (_params: OpenPDFViewerParams): Promise<OpenPDFViewerResult> => {
  // 실 SDK와 동일하게 비동기로 resolve한다.
  await Promise.resolve();
  return 'CLOSE';
};
export const openPDFViewer: ((params: OpenPDFViewerParams) => Promise<OpenPDFViewerResult>) & {
  isSupported: () => boolean;
} = Object.assign(_openPDFViewerImpl, { isSupported: () => true });
