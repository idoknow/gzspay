package top.idoknow.gzspay;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/**
 * NDEF Text 记录解析：payload 结构为 [status][language][text]。
 * 抽成纯 Java，方便在 JVM 单测里覆盖 UTF-8 / UTF-16 与截断输入。
 */
public final class NdefTextParser {

    private NdefTextParser() {
    }

    /** 解析 NDEF Text payload；格式不合法或文本为空时返回 null。 */
    public static String parseText(byte[] payload) {
        if (payload == null || payload.length == 0) {
            return null;
        }
        int status = payload[0] & 0xFF;
        int languageLength = status & 0x3F;
        int offset = 1 + languageLength;
        if (offset >= payload.length) {
            return null;
        }
        Charset charset = (status & 0x80) != 0 ? StandardCharsets.UTF_16 : StandardCharsets.UTF_8;
        String text = new String(payload, offset, payload.length - offset, charset).trim();
        return text.isEmpty() ? null : text;
    }
}
