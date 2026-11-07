package top.idoknow.gzspay;

import android.nfc.cardemulation.HostApduService;
import android.os.Bundle;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * 让这台手机像一张 NFC 标签：对方贴一贴，就读到一个指向 /nfc/&lt;token&gt; 的链接。
 * 按 NFC Forum Type 4 Tag 的 NDEF 读写流程回 APDU。
 */
public class NfcCardService extends HostApduService {

    private static final byte[] NDEF_AID = hex("D2760000850101");
    /** Capability Container：说明这张卡有 0x0034 字节的 NDEF 文件，可读。 */
    private static final byte[] CAPABILITY_CONTAINER = hex("000F20003B00340406E10400FF00FF");
    private static final int FILE_NONE = 0;
    private static final int FILE_CC = 1;
    private static final int FILE_NDEF = 2;

    private static volatile String cardUrl;

    private int selectedFile = FILE_NONE;

    public static void setCardUrl(String url) {
        cardUrl = url;
    }

    public static String getCardUrl() {
        return cardUrl;
    }

    @Override
    public byte[] processCommandApdu(byte[] apdu, Bundle extras) {
        if (apdu == null || apdu.length < 4) {
            return hex("6F00");
        }
        int instruction = apdu[1] & 0xFF;

        if (instruction == 0xA4) {
            int p1 = apdu[2] & 0xFF;
            if (p1 == 0x04) {
                // SELECT by name：NDEF 应用 AID
                int length = apdu[4] & 0xFF;
                byte[] name = Arrays.copyOfRange(apdu, 5, Math.min(5 + length, apdu.length));
                selectedFile = FILE_NONE;
                return Arrays.equals(name, NDEF_AID) ? hex("9000") : hex("6A82");
            }
            if (p1 == 0x00) {
                int fileId = ((apdu[4] & 0xFF) << 8) | (apdu[5] & 0xFF);
                if (fileId == 0xE103) {
                    selectedFile = FILE_CC;
                    return hex("9000");
                }
                if (fileId == 0xE104) {
                    selectedFile = FILE_NDEF;
                    return hex("9000");
                }
                selectedFile = FILE_NONE;
                return hex("6A82");
            }
            return hex("6A86");
        }

        if (instruction == 0xB0) {
            int offset = ((apdu[2] & 0xFF) << 8) | (apdu[3] & 0xFF);
            int want = apdu.length > 4 ? (apdu[4] & 0xFF) : 0;
            if (want == 0) {
                // Le = 00 表示最多 256 字节
                want = 256;
            }
            byte[] content = contentOfSelectedFile();
            if (content == null) {
                return hex("6A82");
            }
            if (offset >= content.length) {
                return hex("6B00");
            }
            int end = Math.min(content.length, offset + want);
            byte[] chunk = Arrays.copyOfRange(content, offset, end);
            byte[] response = new byte[chunk.length + 2];
            System.arraycopy(chunk, 0, response, 0, chunk.length);
            response[chunk.length] = (byte) 0x90;
            response[chunk.length + 1] = 0x00;
            return response;
        }

        return hex("6D00");
    }

    private byte[] contentOfSelectedFile() {
        if (selectedFile == FILE_CC) {
            return CAPABILITY_CONTAINER;
        }
        if (selectedFile != FILE_NDEF) {
            return null;
        }
        return ndefFile();
    }

    /** NDEF 文件内容：前两个字节是消息长度，后面是 NDEF 消息（一条 URL 记录）。 */
    private byte[] ndefFile() {
        String url = cardUrl;
        if (url == null || url.isEmpty()) {
            return null;
        }
        byte[] message = ndefUriRecord(url);
        byte[] file = new byte[message.length + 2];
        file[0] = (byte) ((message.length >> 8) & 0xFF);
        file[1] = (byte) (message.length & 0xFF);
        System.arraycopy(message, 0, file, 2, message.length);
        return file;
    }

    private byte[] ndefUriRecord(String url) {
        int prefixCode = 0x00;
        String rest = url;
        if (url.startsWith("https://")) {
            prefixCode = 0x04;
            rest = url.substring("https://".length());
        } else if (url.startsWith("http://")) {
            prefixCode = 0x03;
            rest = url.substring("http://".length());
        }
        byte[] payloadText = rest.getBytes(StandardCharsets.UTF_8);
        int payloadLength = payloadText.length + 1;
        byte[] record = new byte[4 + payloadLength];
        record[0] = (byte) 0xD1; // MB=1, ME=1, TNF=well known
        record[1] = 0x01;        // type length
        record[2] = (byte) payloadLength;
        record[3] = 'U';
        record[4] = (byte) prefixCode;
        System.arraycopy(payloadText, 0, record, 5, payloadText.length);
        return record;
    }

    @Override
    public void onDeactivated(int reason) {
        selectedFile = FILE_NONE;
    }

    private static byte[] hex(String value) {
        int length = value.length() / 2;
        byte[] result = new byte[length];
        for (int index = 0; index < length; index++) {
            result[index] = (byte) Integer.parseInt(value.substring(index * 2, index * 2 + 2), 16);
        }
        return result;
    }
}
