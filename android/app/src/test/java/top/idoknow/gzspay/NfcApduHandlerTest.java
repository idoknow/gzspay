package top.idoknow.gzspay;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.nio.charset.StandardCharsets;

/** NFC Type 4 Tag 的 APDU 处理：覆盖真机上出过问题的那几条命令。 */
public class NfcApduHandlerTest {

    private static byte[] concat(byte[] head, byte[] tail) {
        byte[] result = new byte[head.length + tail.length];
        System.arraycopy(head, 0, result, 0, head.length);
        System.arraycopy(tail, 0, result, head.length, tail.length);
        return result;
    }

    @Test
    public void selectsNdefApplication() {
        NfcApduHandler handler = new NfcApduHandler();
        byte[] apdu = concat(NfcApduHandler.hex("00A4040007"), NfcApduHandler.hex("D276000085010100"));
        assertArrayEquals(NfcApduHandler.hex("9000"), handler.process(apdu));

        byte[] unknown = concat(NfcApduHandler.hex("00A4040007"), NfcApduHandler.hex("D276000001020300"));
        assertArrayEquals(NfcApduHandler.hex("6A82"), handler.process(unknown));
    }

    /** 读卡端（Android 默认读卡器）选择文件时是带 Lc 的写法，曾经被解析成 0x02E1 而永远回 6A82。 */
    @Test
    public void selectsFileWithOrWithoutLc() {
        NfcApduHandler withLc = new NfcApduHandler();
        assertArrayEquals(NfcApduHandler.hex("9000"), withLc.process(NfcApduHandler.hex("00A4000C02E103")));
        byte[] cc = withLc.process(NfcApduHandler.hex("00B00000FF"));
        assertEquals(17, cc.length); // 15 字节 CC + 9000

        NfcApduHandler withoutLc = new NfcApduHandler();
        assertArrayEquals(NfcApduHandler.hex("9000"), withoutLc.process(NfcApduHandler.hex("00A4000CE103")));
        assertArrayEquals(NfcApduHandler.hex("6A82"), new NfcApduHandler().process(NfcApduHandler.hex("00A4000C02E999")));
    }

    @Test
    public void readsCapabilityContainer() {
        NfcApduHandler handler = new NfcApduHandler();
        handler.process(NfcApduHandler.hex("00A4000C02E103"));
        byte[] response = handler.process(NfcApduHandler.hex("00B0000002"));
        assertEquals(4, response.length);
        assertArrayEquals(NfcApduHandler.hex("000F9000"), response);
    }

    @Test
    public void readsNdefFileWithUrl() {
        NfcApduHandler handler = new NfcApduHandler();
        handler.setCardUrl("https://p.idoknow.top/nfc/abcdef");
        handler.process(NfcApduHandler.hex("00A4000C02E104"));

        // Le=00 表示最多 256 字节，先读前两字节拿到消息长度
        byte[] head = handler.process(NfcApduHandler.hex("00B0000000"));
        int messageLength = ((head[0] & 0xFF) << 8) | (head[1] & 0xFF);
        int payloadLength = "p.idoknow.top/nfc/abcdef".getBytes(StandardCharsets.UTF_8).length + 1;
        assertEquals(payloadLength + 4, messageLength);
        assertEquals((byte) 0xD1, head[2]);
        assertEquals(0x01, head[3]);
        assertEquals((byte) 'U', head[5]);
        assertEquals(0x04, head[6]); // https:// 前缀码
    }

    @Test
    public void returnsNothingWhenCardIsOff() {
        NfcApduHandler handler = new NfcApduHandler();
        handler.process(NfcApduHandler.hex("00A4000C02E104"));
        assertArrayEquals(NfcApduHandler.hex("6A82"), handler.process(NfcApduHandler.hex("00B0000000")));
        assertNull(handler.ndefFile());
    }

    @Test
    public void resetsSelectedFileOnDeactivate() {
        NfcApduHandler handler = new NfcApduHandler();
        handler.setCardUrl("https://p.idoknow.top/nfc/abcdef");
        handler.process(NfcApduHandler.hex("00A4000C02E104"));
        handler.reset();
        assertArrayEquals(NfcApduHandler.hex("6A82"), handler.process(NfcApduHandler.hex("00B0000000")));
    }

    @Test
    public void unknownInstructionIsRejected() {
        assertArrayEquals(NfcApduHandler.hex("6D00"), new NfcApduHandler().process(NfcApduHandler.hex("00CA000000")));
        assertArrayEquals(NfcApduHandler.hex("6F00"), new NfcApduHandler().process(null));
    }
}
