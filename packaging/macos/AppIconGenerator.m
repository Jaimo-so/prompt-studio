#import <AppKit/AppKit.h>

static NSBezierPath *Sparkle(NSPoint center, CGFloat radius) {
    NSBezierPath *path = [NSBezierPath bezierPath];
    [path moveToPoint:NSMakePoint(center.x, center.y + radius)];
    [path curveToPoint:NSMakePoint(center.x + radius, center.y) controlPoint1:NSMakePoint(center.x + radius * .18, center.y + radius * .18) controlPoint2:NSMakePoint(center.x + radius * .18, center.y + radius * .18)];
    [path curveToPoint:NSMakePoint(center.x, center.y - radius) controlPoint1:NSMakePoint(center.x + radius * .18, center.y - radius * .18) controlPoint2:NSMakePoint(center.x + radius * .18, center.y - radius * .18)];
    [path curveToPoint:NSMakePoint(center.x - radius, center.y) controlPoint1:NSMakePoint(center.x - radius * .18, center.y - radius * .18) controlPoint2:NSMakePoint(center.x - radius * .18, center.y - radius * .18)];
    [path curveToPoint:NSMakePoint(center.x, center.y + radius) controlPoint1:NSMakePoint(center.x - radius * .18, center.y + radius * .18) controlPoint2:NSMakePoint(center.x - radius * .18, center.y + radius * .18)];
    [path closePath];
    return path;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return 1;
        NSString *outputPath = [NSString stringWithUTF8String:argv[1]];
        NSArray<NSArray *> *variants = @[@[@"icp4", @16], @[@"icp5", @32], @[@"icp6", @64], @[@"ic07", @128], @[@"ic08", @256], @[@"ic09", @512], @[@"ic10", @1024]];
        NSMutableData *chunks = [NSMutableData data];

        for (NSArray *variant in variants) {
            NSInteger pixels = [variant[1] integerValue];
            CGFloat size = pixels;
            NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nil pixelsWide:pixels pixelsHigh:pixels bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
            bitmap.size = NSMakeSize(size, size);
            [NSGraphicsContext saveGraphicsState];
            NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
            [NSColor.clearColor setFill];
            NSRectFill(NSMakeRect(0, 0, size, size));
            CGFloat inset = size * .055;
            NSBezierPath *tile = [NSBezierPath bezierPathWithRoundedRect:NSMakeRect(inset, inset, size - inset * 2, size - inset * 2) xRadius:size * .22 yRadius:size * .22];
            NSGradient *gradient = [[NSGradient alloc] initWithColors:@[[NSColor colorWithRed:.16 green:.29 blue:.92 alpha:1], [NSColor colorWithRed:.32 green:.20 blue:.82 alpha:1]]];
            [gradient drawInBezierPath:tile angle:-52];
            [[NSColor.whiteColor colorWithAlphaComponent:.08] setFill];
            [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(size * .12, size * .54, size * .70, size * .50)] fill];
            [NSColor.whiteColor setFill];
            [Sparkle(NSMakePoint(size * .50, size * .54), size * .25) fill];
            [[NSColor colorWithRed:.72 green:.82 blue:1 alpha:1] setFill];
            [Sparkle(NSMakePoint(size * .72, size * .30), size * .085) fill];
            [NSGraphicsContext restoreGraphicsState];
            NSData *data = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            NSData *type = [variant[0] dataUsingEncoding:NSASCIIStringEncoding];
            uint32_t chunkLength = CFSwapInt32HostToBig((uint32_t)(data.length + 8));
            [chunks appendData:type];
            [chunks appendBytes:&chunkLength length:sizeof(chunkLength)];
            [chunks appendData:data];
        }

        NSMutableData *icon = [NSMutableData dataWithBytes:"icns" length:4];
        uint32_t totalLength = CFSwapInt32HostToBig((uint32_t)(chunks.length + 8));
        [icon appendBytes:&totalLength length:sizeof(totalLength)];
        [icon appendData:chunks];
        if (![icon writeToFile:outputPath atomically:YES]) return 2;
    }
    return 0;
}
