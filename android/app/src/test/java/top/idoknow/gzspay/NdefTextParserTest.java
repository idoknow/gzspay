package top.idoknow.gzspay;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

public class NdefTextParserTest {

    private static byte[] textPayload(int status, String language, String text) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(status);
        byte[] languageBytes = language.getBytes(StandardCharsets.US_ASCII);
        out.write(languageBytes, 0, languageBytes.length);
        byte[] textBytes = (status & 0x80) != 0
                ? text.getBytes(StandardCharsets.UTF_16BE)
                : text.getBytes(StandardCharsets.UTF_8);
        out.write(textBytes, 0, textBytes.length);
        return out.toByteArray();
    }

    @Test
    public void parsesUtf8Text() {
        byte[] payload = textPayload(0x02, "en", "A1B2C3D4");
        assertEquals("A1B2C3D4", NdefTextParser.parseText(payload));
    }

    @Test
    public void parsesUtf16Text() {
        byte[] payload = textPayload(0x82, "en", "A1B2C3D4");
        assertEquals("A1B2C3D4", NdefTextParser.parseText(payload));
    }

    @Test
    public void trimsWhitespace() {
        byte[] payload = textPayload(0x00, "", "  A1B2C3D4  ");
        assertEquals("A1B2C3D4", NdefTextParser.parseText(payload));
    }

    @Test
    public void rejectsNullOrEmpty() {
        assertNull(NdefTextParser.parseText(null));
        assertNull(NdefTextParser.parseText(new byte[0]));
    }

    @Test
    public void rejectsTruncatedLanguageCode() {
        byte[] payload = new byte[]{0x05, 'e', 'n'};
        assertNull(NdefTextParser.parseText(payload));
    }

    @Test
    public void rejectsBlankText() {
        byte[] payload = textPayload(0x00, "", "   ");
        assertNull(NdefTextParser.parseText(payload));
    }
}
