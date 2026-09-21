/** Foydalanuvchiga ko'rsatiladigan xato: handler `throw new BotError('matn')` qiladi — factory shu matnni yuboradi (stack yo'q). */
export class BotError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BotError';
  }
}
