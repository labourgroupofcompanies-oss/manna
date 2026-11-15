/**
 * Voice Audio Storage and Processing Service (Stub)
 * Future implementation will handle voice audio upload to Supabase Storage.
 */
export const voiceService = {
  async uploadVoiceNote(_blob: Blob, _orderId: string): Promise<string | null> {
    console.info('Voice note upload to Supabase storage will be implemented here.');
    return null;
  }
};
