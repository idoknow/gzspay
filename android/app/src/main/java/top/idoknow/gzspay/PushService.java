package top.idoknow.gzspay;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/** FCM 消息入口：前台收到时自己弹通知，后台由系统按 notification 载荷展示。 */
public class PushService extends FirebaseMessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        PushStore.saveToken(this, token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        RemoteMessage.Notification notification = message.getNotification();
        String title = notification != null ? notification.getTitle() : data.get("title");
        String body = notification != null ? notification.getBody() : data.get("body");
        PushNotifications.show(this, title, body, data.get("url"));
    }
}
