# 安卓客户端

`android/` 是一个很薄的壳：页面仍然是站点本身（同一套账号、订单与工单），客户端只补上网页做不到的几件事——应用锁、NFC 卡片、NFC 读卡、通知推送与本地缓存。

## 能做什么

- **打开就是站点**：启动后用 WebView 打开 `https://p.idoknow.top`（地址写在 `android/app/build.gradle` 的 `DEFAULT_BASE_URL`），账号、订单、工单、收付款码与网页完全一致。
- **应用锁**：四位数密码、六位数密码、手势密码，或者调用系统的指纹 / 人脸。锁只在本地生效，密码只保存加盐哈希；冷启动必须验证，切到后台超过 30 秒再回来也要重新验证，未验证就退出应用。设置界面在网页里（「设置 → 客户端 → 应用锁设置」），原生只保留解锁界面。
- **NFC 卡片**：开关只在客户端内的「我的卡片」页显示（浏览器里不出现）。开启后客户端会带着登录状态取回 `https://<站点>/nfc/<token>`，并用 HCE 把手机自己变成一张 NFC 标签（Type 4 Tag，NDEF URI 记录）。对方用手机贴一贴即可打开这张（只有脱敏信息的）卡片页；在客户端里关闭或更换链接后，客户端会立刻重新同步，之后每 30 秒也会自动同步一次。
- **NFC 读卡**：WebView 不支持网页 NFC，客户端改用系统 NFC 读卡（原生 ReaderMode + NDEF 文本解析）。绑定校园卡、扫码页的「NFC 读卡」在客户端里都能用，读到的卡号会回填到网页。
- **本地缓存**：WebView 默认缓存（`LOAD_DEFAULT`）、DOM Storage 与数据库都打开，静态资源命中浏览器缓存，弱网时首屏更快。
- **设备识别**：请求带 `GzspayApp/<版本>` 的 UA，服务端会在「登录设备管理」里把它显示为「gzspay 客户端」。
- **通知推送**：接入 FCM。进入应用时会请求通知与相机权限；「设置 → 客户端 → 权限与通知」能看到通知 / 相机 / NFC 的授权状态与推送令牌是否已注册。服务端在收款请求、订单状态与工单消息时推送，点开通知跳到订单或工单详情。没有放 `google-services.json` 时 APK 仍可编译，只是没有推送令牌。
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

正式分发用 release 签名：

```bash
cd android
./gradlew assembleRelease
# 产物：android/app/build/outputs/apk/release/app-release.apk
```

签名配置从 `android/keystore.properties` 读取（不入库，`android/keystore/` 同样不入库）：

```properties
storeFile=keystore/gzspay-release.jks
storePassword=<密码>
keyAlias=gzspay
keyPassword=<密码>
```

没有这个文件时 release 会退化成 debug 签名，方便别人只改代码时打包。**keystore 与密码必须自己备份**，换掉之后新包无法覆盖安装旧包，只能卸载重装。

FCM 推送还需要把 Firebase 项目的 `android/app/google-services.json` 放到 `android/app/`（不入库）；插件按文件是否存在决定是否应用，没有该文件时构建仍成功，但客户端拿不到推送令牌。服务端需要配置 `FCM_SERVICE_ACCOUNT_JSON` 或 `FCM_SERVICE_ACCOUNT_FILE`，未配置时推送静默跳过。

## 使用

- **应用锁**：在客户端里打开「设置」→「客户端」→「应用锁设置」，在网页里选四/六位数字或手势（都要输入两次）；设置好后可以打开「指纹 / 人脸解锁」。「关闭应用锁」会清掉本地保存的哈希。浏览器里打开这个页面会提示仅在客户端可用。
- **NFC 卡片**：只在客户端内的「我的卡片」页显示开关；打开后手机开启 NFC 并点亮屏幕（HCE 只在解锁状态响应），对方手机贴近背面即可读取。没开启时读取会提示卡片不存在。
- **权限与通知**：「设置」→「客户端」→「权限与通知」查看通知 / 相机 / NFC 状态；通知与相机权限在进入应用时会询问一次，被拒绝后可以在这里重新请求或跳到系统设置。
- **刷新卡片**：同一张「客户端」卡片里的「刷新 NFC」，用于在网页上更换链接后立刻生效；正常情况每 30 秒也会自动同步。

## 测试

NFC 的 APDU 处理抽在 `NfcApduHandler`，读卡侧的 NDEF 文本解析抽在 `NdefTextParser`（都是纯 Java，不依赖 Android），带一组单元测试，覆盖「带 Lc / 不带 Lc 选择文件」「读 Capability Container」「读 NDEF 文件」「卡片关闭时读不到」「UTF-8 / UTF-16 文本解析」等真机上容易踩的点：

```bash
cd android
./gradlew :app:testReleaseUnitTest
```

## 排障

```bash
# 看客户端同步 NFC 卡片的过程
adb logcat -s gzspay-nfc

# 确认手机支持 HCE、当前已注册的 AID
adb shell dumpsys nfc | findstr /i "D2760000850101"
```

- 日志里 `sync ok, enabled=false` 表示网页上还没打开 NFC 卡片开关，不是客户端的问题。
- 日志里 `no cookie yet` 表示 WebView 还没登录，登录后会自动重试。
- 别人贴读没有任何反应时，先确认双方手机的 NFC 天线位置（一般在背面靠上），以及被读手机上「NFC 卡片」是否已开启。
- 收不到推送时，先确认安装包里有 `google-services.json`、系统通知权限已开，再在「设置 → 客户端 → 权限与通知」看推送令牌是否显示「已注册」；服务端还要配置 `FCM_SERVICE_ACCOUNT_*`。

## 边界

- 客户端不缓存任何业务数据（订单、工单、截图都只在网页里按需请求），退出登录由网页负责。
- NFC 卡面只有姓名、打码学号、打码校园卡号与是否商家，没有令牌以外的身份信息；令牌可随时更换或关闭。
- 读取卡片依赖手机的 HCE 能力（绝大多数带 NFC 的安卓手机都支持）；iPhone 不能作为这张卡的“卡片方”，但可以用相机扫二维码。
