const { db } = require('./db');
function attachToMessage(messageId, attachments) {
  if (attachments == null) return;
  if (!Array.isArray(attachments) || attachments.length > 3)
    throw Object.assign(new Error('Use até três anexos.'), { status: 400 });
  for (const attachment of attachments) {
    if (
      !attachment ||
      typeof attachment.filename !== 'string' ||
      !attachment.filename.trim() ||
      attachment.filename.length > 120 ||
      typeof attachment.data_base64 !== 'string' ||
      attachment.data_base64.length > 2796204 ||
      !attachment.data_base64.length ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        attachment.data_base64
      )
    )
      throw Object.assign(new Error('Anexo inválido.'), { status: 400 });
    const bytes = Buffer.from(attachment.data_base64, 'base64');
    const signatures = {
      'image/png': () =>
        bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
      'image/jpeg': () =>
        bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      'image/gif': () =>
        ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString()),
      'image/webp': () =>
        bytes.subarray(0, 4).toString() === 'RIFF' &&
        bytes.subarray(8, 12).toString() === 'WEBP',
      'application/pdf': () => bytes.subarray(0, 5).toString() === '%PDF-',
    };
    if (
      bytes.length > 2 * 1024 * 1024 ||
      !Object.hasOwn(signatures, attachment.mime_type) ||
      !signatures[attachment.mime_type]()
    )
      throw Object.assign(new Error('Tipo ou tamanho de anexo inválido.'), {
        status: 400,
      });
    db.prepare(
      'INSERT INTO ticket_attachments(message_id,filename,mime_type,data_base64,size_bytes) VALUES(?,?,?,?,?)'
    ).run(
      messageId,
      attachment.filename,
      attachment.mime_type,
      attachment.data_base64,
      bytes.length
    );
  }
}
module.exports = { attachToMessage };
