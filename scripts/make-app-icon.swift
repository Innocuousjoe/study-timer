// Renders ios/StudyTimer/Images.xcassets/AppIcon.appiconset/AppIcon.png.
//   swiftc -o /tmp/make-app-icon scripts/make-app-icon.swift && /tmp/make-app-icon <out.png>
import AppKit
import UniformTypeIdentifiers

let size = 1024
let s = CGFloat(size)
// RGBX: no alpha channel in the output (App Store icons must be opaque).
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
// Full-bleed background; iOS applies the rounded mask itself.
let colors = [CGColor(srgbRed: 0.36, green: 0.42, blue: 1.0, alpha: 1),
              CGColor(srgbRed: 0.16, green: 0.18, blue: 0.55, alpha: 1)] as CFArray
let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!, colors: colors, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: s), end: CGPoint(x: s, y: 0), options: [])

NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
let config = NSImage.SymbolConfiguration(pointSize: 480, weight: .semibold)
  .applying(.init(paletteColors: [.white]))
let symbol = NSImage(systemSymbolName: "book.fill", accessibilityDescription: nil)!.withSymbolConfiguration(config)!
let sz = symbol.size
symbol.draw(in: NSRect(x: (s - sz.width) / 2, y: (s - sz.height) / 2, width: sz.width, height: sz.height))

let url = URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL
let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
CGImageDestinationFinalize(dest)
