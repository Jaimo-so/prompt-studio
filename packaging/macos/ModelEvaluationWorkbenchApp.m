#import <Cocoa/Cocoa.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <WebKit/WebKit.h>

static NSString *const WorkbenchURL = @"http://127.0.0.1:17329/";
static NSString *const HealthURL = @"http://127.0.0.1:17329/api/health";

@interface AppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSTask *serverProcess;
@property(nonatomic, strong) NSTimer *healthTimer;
@property(nonatomic, strong) NSMutableString *serverLog;
@property(nonatomic, strong) NSURL *lastDownloadDestination;
@property(nonatomic) NSInteger attemptsRemaining;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.serverLog = [NSMutableString string];
    self.attemptsRemaining = 120;
    [self configureMenus];
    [self configureWindow];
    [self showLoadingPage];
    [self startServer];
    [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }

- (void)applicationWillTerminate:(NSNotification *)notification {
    [self.healthTimer invalidate];
    if (self.serverProcess.isRunning) [self.serverProcess terminate];
}

- (void)configureWindow {
    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    configuration.websiteDataStore = WKWebsiteDataStore.defaultDataStore;
    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
    self.webView.navigationDelegate = self;
    self.webView.UIDelegate = self;
    self.webView.allowsMagnification = YES;

    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1440, 900)
                                               styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView
                                                 backing:NSBackingStoreBuffered
                                                   defer:NO];
    self.window.title = @"模型评测工作站";
    self.window.minSize = NSMakeSize(1040, 680);
    self.window.contentView = self.webView;
    self.window.delegate = self;
    [self.window setFrameAutosaveName:@"ModelEvaluationWorkbenchMainWindow"];
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
}

- (void)configureMenus {
    NSMenu *mainMenu = [[NSMenu alloc] init];
    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    NSMenu *appMenu = [[NSMenu alloc] init];
    [appMenu addItemWithTitle:@"关于模型评测工作站" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [appMenu addItem:NSMenuItem.separatorItem];
    [appMenu addItemWithTitle:@"隐藏模型评测工作站" action:@selector(hide:) keyEquivalent:@"h"];
    NSMenuItem *hideOthers = [appMenu addItemWithTitle:@"隐藏其他应用" action:@selector(hideOtherApplications:) keyEquivalent:@"h"];
    hideOthers.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagOption;
    [appMenu addItemWithTitle:@"显示全部" action:@selector(unhideAllApplications:) keyEquivalent:@""];
    [appMenu addItem:NSMenuItem.separatorItem];
    [appMenu addItemWithTitle:@"退出模型评测工作站" action:@selector(terminate:) keyEquivalent:@"q"];
    appMenuItem.submenu = appMenu;
    [mainMenu addItem:appMenuItem];

    NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"编辑"];
    [editMenu addItemWithTitle:@"撤销" action:@selector(undo:) keyEquivalent:@"z"];
    [editMenu addItemWithTitle:@"重做" action:@selector(redo:) keyEquivalent:@"Z"];
    [editMenu addItem:NSMenuItem.separatorItem];
    [editMenu addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"复制" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];
    editMenuItem.submenu = editMenu;
    [mainMenu addItem:editMenuItem];

    NSMenuItem *windowMenuItem = [[NSMenuItem alloc] init];
    NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"窗口"];
    [windowMenu addItemWithTitle:@"最小化" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
    [windowMenu addItemWithTitle:@"缩放" action:@selector(performZoom:) keyEquivalent:@""];
    windowMenuItem.submenu = windowMenu;
    [mainMenu addItem:windowMenuItem];
    NSApp.windowsMenu = windowMenu;
    NSApp.mainMenu = mainMenu;
}

- (void)showLoadingPage {
    NSString *html = @"<!doctype html><html lang='zh-CN'><meta charset='utf-8'><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f7;color:#172033;font:14px -apple-system,BlinkMacSystemFont,sans-serif}.card{display:grid;justify-items:center;gap:16px}.mark{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;background:#315eea;color:white;box-shadow:0 14px 30px rgba(49,94,234,.24);font-size:28px}.spinner{width:20px;height:20px;border:2px solid #d9dfed;border-top-color:#315eea;border-radius:50%;animation:spin .8s linear infinite}p{margin:0;color:#6b7383}@keyframes spin{to{transform:rotate(360deg)}}</style><body><div class='card'><div class='mark'>✦</div><strong>模型评测工作站</strong><div class='spinner'></div><p>正在启动本地服务…</p></div></body></html>";
    [self.webView loadHTMLString:html baseURL:nil];
}

- (void)startServer {
    NSURL *resources = NSBundle.mainBundle.resourceURL;
    NSString *migrationRoot = [NSBundle.mainBundle objectForInfoDictionaryKey:@"WorkbenchDataRoot"];
    if (!resources || ![migrationRoot isKindOfClass:NSString.class]) {
        [self showStartupError:@"应用资源不完整，请重新构建应用。"];
        return;
    }

    NSFileManager *fileManager = NSFileManager.defaultManager;
    NSURL *applicationSupport = [[fileManager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask] firstObject];
    NSURL *dataRootURL = [applicationSupport URLByAppendingPathComponent:@"模型评测工作站" isDirectory:YES];
    NSError *storageError = nil;
    if (![fileManager createDirectoryAtURL:dataRootURL withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions: @0700} error:&storageError]) {
        [self showStartupError:[NSString stringWithFormat:@"无法创建应用数据目录：%@", storageError.localizedDescription]];
        return;
    }

    for (NSString *fileName in @[@".model-api-settings.json", @".env", @".env.local", @".env.production", @".env.production.local"]) {
        NSURL *source = [NSURL fileURLWithPath:[migrationRoot stringByAppendingPathComponent:fileName]];
        NSURL *destination = [dataRootURL URLByAppendingPathComponent:fileName];
        if (![fileManager fileExistsAtPath:destination.path] && [fileManager fileExistsAtPath:source.path]) {
            if (![fileManager copyItemAtURL:source toURL:destination error:&storageError]) {
                [self showStartupError:[NSString stringWithFormat:@"无法迁移本地配置：%@", storageError.localizedDescription]];
                return;
            }
            [fileManager setAttributes:@{NSFilePosixPermissions: @0600} ofItemAtPath:destination.path error:nil];
        }
    }

    NSURL *nodeURL = [resources URLByAppendingPathComponent:@"node"];
    NSURL *serverURL = [resources URLByAppendingPathComponent:@"server.mjs"];
    if (![fileManager isExecutableFileAtPath:nodeURL.path] || ![fileManager fileExistsAtPath:serverURL.path]) {
        [self showStartupError:@"应用缺少运行组件，请重新构建应用。"];
        return;
    }

    NSTask *process = [[NSTask alloc] init];
    process.executableURL = nodeURL;
    process.arguments = @[serverURL.path];
    process.currentDirectoryURL = resources;
    NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
    environment[@"NODE_ENV"] = @"production";
    environment[@"HOST"] = @"127.0.0.1";
    environment[@"PORT"] = @"17329";
    environment[@"MODEL_WORKBENCH_DATA_DIR"] = dataRootURL.path;
    environment[@"MODEL_WORKBENCH_PARENT_PID"] = [NSString stringWithFormat:@"%d", NSProcessInfo.processInfo.processIdentifier];
    process.environment = environment;

    NSPipe *pipe = [NSPipe pipe];
    process.standardOutput = pipe;
    process.standardError = pipe;
    __weak typeof(self) weakSelf = self;
    pipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        NSData *data = handle.availableData;
        if (data.length == 0) return;
        NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (!text) return;
        @synchronized (weakSelf) {
            [weakSelf.serverLog appendString:text];
            if (weakSelf.serverLog.length > 12000) [weakSelf.serverLog deleteCharactersInRange:NSMakeRange(0, weakSelf.serverLog.length - 12000)];
        }
    };

    NSError *error = nil;
    if ([process launchAndReturnError:&error]) {
        self.serverProcess = process;
        [self beginHealthChecks];
    } else {
        [self showStartupError:[NSString stringWithFormat:@"无法启动本地服务：%@", error.localizedDescription]];
    }
}

- (void)beginHealthChecks {
    __weak typeof(self) weakSelf = self;
    self.healthTimer = [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *timer) {
        typeof(self) self = weakSelf;
        if (!self) return;
        self.attemptsRemaining -= 1;
        if (self.attemptsRemaining <= 0) {
            [timer invalidate];
            [self showStartupError:[NSString stringWithFormat:@"本地服务启动超时。\n\n%@", [self currentServerLog]]];
            return;
        }

        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:HealthURL]];
        request.timeoutInterval = 0.5;
        [[NSURLSession.sharedSession dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
            NSDictionary *json = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
            if (http.statusCode != 200 || ![json[@"name"] isEqualToString:@"model-evaluation-workbench"]) return;
            dispatch_async(dispatch_get_main_queue(), ^{
                [self.healthTimer invalidate];
                [self.webView loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:WorkbenchURL]]];
            });
        }] resume];
    }];
}

- (NSString *)currentServerLog {
    @synchronized (self) { return [self.serverLog stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]; }
}

- (void)showStartupError:(NSString *)message {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSString *escaped = [[[[message stringByReplacingOccurrencesOfString:@"&" withString:@"&amp;"] stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"] stringByReplacingOccurrencesOfString:@">" withString:@"&gt;"] stringByReplacingOccurrencesOfString:@"\n" withString:@"<br>"];
        NSString *html = [NSString stringWithFormat:@"<!doctype html><html lang='zh-CN'><meta charset='utf-8'><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f7;color:#172033;font:14px -apple-system,BlinkMacSystemFont,sans-serif}.card{max-width:680px;padding:28px;border:1px solid #dfe3ec;border-radius:16px;background:white;box-shadow:0 14px 34px rgba(32,44,71,.08)}h1{margin:0 0 12px;font-size:18px}p{margin:0;color:#596274;line-height:1.7}</style><body><div class='card'><h1>工作站未能启动</h1><p>%@</p></div></body></html>", escaped];
        [self.webView loadHTMLString:html baseURL:nil];
    });
}

- (void)webView:(WKWebView *)webView
decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    BOOL isBlobDownload = [navigationAction.request.URL.scheme.lowercaseString isEqualToString:@"blob"];
    if (navigationAction.shouldPerformDownload || isBlobDownload) {
        decisionHandler(WKNavigationActionPolicyDownload);
        return;
    }
    decisionHandler(WKNavigationActionPolicyAllow);
}

- (void)webView:(WKWebView *)webView
navigationAction:(WKNavigationAction *)navigationAction
didBecomeDownload:(WKDownload *)download {
    download.delegate = self;
}

- (void)webView:(WKWebView *)webView
navigationResponse:(WKNavigationResponse *)navigationResponse
didBecomeDownload:(WKDownload *)download {
    download.delegate = self;
}

- (void)download:(WKDownload *)download
decideDestinationUsingResponse:(NSURLResponse *)response
suggestedFilename:(NSString *)suggestedFilename
completionHandler:(void (^)(NSURL *destination))completionHandler {
    NSSavePanel *panel = [NSSavePanel savePanel];
    panel.nameFieldStringValue = suggestedFilename.length ? suggestedFilename : @"模型评测结果.xlsx";
    UTType *xlsxType = [UTType typeWithFilenameExtension:@"xlsx"];
    if (xlsxType) panel.allowedContentTypes = @[xlsxType];
    panel.canCreateDirectories = YES;
    panel.message = @"保存已写入模型输出的 Excel 文件";
    panel.prompt = @"保存";

    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
        if (result != NSModalResponseOK || !panel.URL) {
            completionHandler(nil);
            return;
        }

        NSURL *destination = panel.URL;
        if ([NSFileManager.defaultManager fileExistsAtPath:destination.path]) {
            NSError *removeError = nil;
            if (![NSFileManager.defaultManager removeItemAtURL:destination error:&removeError]) {
                NSAlert *alert = [[NSAlert alloc] init];
                alert.messageText = @"无法覆盖现有文件";
                alert.informativeText = removeError.localizedDescription ?: @"请选择其他保存位置。";
                [alert addButtonWithTitle:@"好"];
                [alert beginSheetModalForWindow:self.window completionHandler:nil];
                completionHandler(nil);
                return;
            }
        }

        self.lastDownloadDestination = destination;
        completionHandler(destination);
    }];
}

- (void)downloadDidFinish:(WKDownload *)download {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"结果 Excel 已保存";
    alert.informativeText = self.lastDownloadDestination.path ?: @"文件已保存到所选位置。";
    [alert addButtonWithTitle:@"好"];
    [alert beginSheetModalForWindow:self.window completionHandler:nil];
}

- (void)download:(WKDownload *)download didFailWithError:(NSError *)error resumeData:(NSData *)resumeData {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"结果 Excel 保存失败";
    alert.informativeText = error.localizedDescription ?: @"请重新选择保存位置后再试。";
    [alert addButtonWithTitle:@"好"];
    [alert beginSheetModalForWindow:self.window completionHandler:nil];
}

- (void)webView:(WKWebView *)webView
runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
initiatedByFrame:(WKFrameInfo *)frame
completionHandler:(void (^)(NSArray<NSURL *> *URLs))completionHandler {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = YES;
    panel.canChooseDirectories = parameters.allowsDirectories;
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection;
    panel.resolvesAliases = YES;
    NSMutableArray<UTType *> *excelTypes = [NSMutableArray array];
    for (NSString *extension in @[@"xlsx", @"xls", @"xlsm", @"xlsb"]) {
        UTType *type = [UTType typeWithFilenameExtension:extension];
        if (type) [excelTypes addObject:type];
    }
    panel.allowedContentTypes = excelTypes;
    panel.message = @"请选择包含模型评测输入的 Excel 文件";
    panel.prompt = @"导入";

    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response) {
        completionHandler(response == NSModalResponseOK ? panel.URLs : @[]);
    }];
}

- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = message;
    [alert addButtonWithTitle:@"好"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response) { completionHandler(); }];
}

- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = message;
    [alert addButtonWithTitle:@"确认"];
    [alert addButtonWithTitle:@"取消"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response) { completionHandler(response == NSAlertFirstButtonReturn); }];
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = NSApplication.sharedApplication;
        AppDelegate *delegate = [[AppDelegate alloc] init];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application run];
    }
    return 0;
}
