# 安卓客户端

`android/` 是一个很薄的壳：页面仍然是站点本身（同一套账号、订单与工单），客户端只补上网页做不到的几件事——应用锁、NFC 卡片与本地缓存。

## 能做什么

- **打开就是站点**：启动后用 WebView 打开 `https://p.idoknow.top`（地址写在 `android/app/build.gradle` 的 `DEFAULT_BASE_URL`），账号、订单、工单、收付款码与网页完全一致。
- **应用锁**：四位数密码、六位数密码、手势密码，或者调用系统的指纹 / 人脸。锁只在本地生效，密码只保存加盐哈希；冷启动必须验证，切到后台超过 30 秒再回来也要重新验证，未验证就退出应用。
- **NFC 卡片**：先在「我的卡片」页开启 NFC 卡片，客户端会带着登录状态取回 `https://<站点>/nfc/<token>`，并用 HCE 把手机自己变成一张 NFC 标签。对方用手机贴一贴即可打开这张（只有脱敏信息的）卡片页；在网页上关闭或更换链接后，客户端下次回到前台会自动同步。
- **本地缓存**：WebView 默认缓存（`LOAD_DEFAULT`）、DOM Storage 与数据库都打开，静态资源命中浏览器缓存，弱网时首屏更快。
- **设备识别**：请求带 `GzspayApp/<版本>` 的 UA，服务端会在「登录设备管理」里把它显示为「gzspay 客户端」。
- **能唤起支付宝**：网页里的「支付宝一键付款」会跳到 `alipays://`，客户端把这类非 http(s) 链接交给系统处理，微信内置浏览器打不开的问题在这里不存在。

## 构建

需要 JDK 17 与 Android SDK（platform 34、build-tools 34.0.0）。

```bash
# 本机 SDK 路径写在 android/local.properties（不入库）
# sdk.dir=/path/to/android-sdk

cd android
./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

安装到手机：

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

正式分发时换成自己的签名：在 `android/app/build.gradle` 的 `signingConfigs` 里配置 keystore，再跑 `./gradlew assembleRelease`。

## 使用

- **应用锁**：在客户端里点右上角菜单 →「应用锁设置」，选四/六位数字或手势（都要输入两次）；设置好后可以再打开「允许用指纹 / 人脸解锁」。「关闭应用锁」会清掉本地保存的哈希。
- **NFC 卡片**：先在网页「我的」→ 顶部卡片 →「NFC 卡片」开关打开；手机开启 NFC 并点亮屏幕，对方手机贴近背面即可读取。没开启时读取会提示卡片不存在。
- **刷新卡片**：菜单里有「刷新 NFC 卡片」，用于在网页上更换链接后立刻生效。

## 边界

- 客户端不缓存任何业务数据（订单、工单、截图都只在网页里按需请求），退出登录由网页负责。
- NFC 卡面只有姓名、打码学号、打码校园卡号与是否商家，没有令牌以外的身份信息；令牌可随时更换或关闭。
- 读取卡片依赖手机的 HCE 能力（绝大多数带 NFC 的安卓手机都支持）；iPhone 不能作为这张卡的“卡片方”，但可以用相机扫二维码。
