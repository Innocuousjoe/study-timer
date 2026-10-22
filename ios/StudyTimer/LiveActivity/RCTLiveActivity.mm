// TurboModule for `src/native/NativeLiveActivity.ts`.
//
// Codegen turns the TypeScript spec into the Objective-C++ protocol
// `NativeLiveActivitySpec`. Swift can't adopt C++-typed protocols, so this file
// conforms to it, unpacks the codegen structs, and forwards to the Swift
// `LiveActivityBridge`, which does the ActivityKit work.

#import <Foundation/Foundation.h>
#import <StudyTimerSpec/StudyTimerSpec.h>

// The generated Swift header also declares the app's SceneDelegate, whose
// superclass comes from React-RCTAppDelegate, so that must be imported first.
#import <React-RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
#import "StudyTimer-Swift.h"

@interface RCTLiveActivity : NSObject <NativeLiveActivitySpec>
@end

@implementation RCTLiveActivity

RCT_EXPORT_MODULE(LiveActivity)

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeLiveActivitySpecJSI>(params);
}

static NSNumber *_Nullable PausedAt(JS::NativeLiveActivity::ActivitySessionSpec &session)
{
  std::optional<double> pausedAt = session.pausedAt();
  return pausedAt.has_value() ? @(pausedAt.value()) : nil;
}

- (NSNumber *)areActivitiesEnabled
{
  return @([LiveActivityBridge.shared areActivitiesEnabled]);
}

- (void)startActivity:(JS::NativeLiveActivity::ActivitySessionSpec &)session
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject
{
  [LiveActivityBridge.shared startWithSessionId:session.sessionId()
                                           name:session.name()
                                    goalSeconds:session.goalSeconds()
                                    startDateMs:session.startDate()
                                     pausedAtMs:PausedAt(session)
                                     completion:^(NSString *activityId, NSError *error) {
                                       if (error) {
                                         reject(@"E_LIVE_ACTIVITY_START", error.localizedDescription, error);
                                       } else {
                                         resolve(activityId);
                                       }
                                     }];
}

- (void)updateActivity:(JS::NativeLiveActivity::ActivitySessionSpec &)session
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  [LiveActivityBridge.shared updateWithSessionId:session.sessionId()
                                            name:session.name()
                                     goalSeconds:session.goalSeconds()
                                     startDateMs:session.startDate()
                                      pausedAtMs:PausedAt(session)
                                      completion:^{
                                        resolve(nil);
                                      }];
}

- (void)endActivity:(NSString *)activityId
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [LiveActivityBridge.shared endWithActivityId:activityId
                                    completion:^{
                                      resolve(nil);
                                    }];
}

- (void)endAllActivities:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [LiveActivityBridge.shared endAllWithCompletion:^{
    resolve(nil);
  }];
}

- (void)listActivities:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [LiveActivityBridge.shared listWithCompletion:^(NSArray<NSDictionary<NSString *, id> *> *activities) {
    resolve(activities);
  }];
}

@end
