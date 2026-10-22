# One-time, idempotent setup of the Xcode project for Live Activities:
#   - app target: iOS 17, native Live Activity sources, shared attributes
#   - StudyTimerWidget: WidgetKit extension embedded in the app
#   - StudyTimerTests: host-less XCTest bundle for the Swift controller
#
# The result is checked in; you only need to re-run this if you regenerate
# the ios/ folder. It uses the xcodeproj gem that ships with CocoaPods:
#
#   GEM_HOME="$(brew --prefix cocoapods)/libexec" "$(brew --prefix ruby)/bin/ruby" \
#     scripts/configure-xcode-project.rb
require 'xcodeproj'

IOS_DIR = File.expand_path('../ios', __dir__)
project = Xcodeproj::Project.open(File.join(IOS_DIR, 'StudyTimer.xcodeproj'))
app = project.targets.find { |t| t.name == 'StudyTimer' } or abort 'StudyTimer target not found'

DEPLOYMENT_TARGET = '17.0'
BUNDLE_ID = 'com.ncoelius.studytimer'

# Groups resolve relative to their parent, and the template's StudyTimer group
# has no path of its own, so pin each group's path relative to ios/.
def group_for(project, path)
  group = project.main_group.find_subpath(path, true)
  group.set_source_tree('<group>')
  parent_path = group.parent.real_path.relative_path_from(Pathname(IOS_DIR)).to_s
  group.set_path(parent_path == '.' ? path : Pathname(path).relative_path_from(Pathname(parent_path)).to_s)
  group
end

def add_sources(target, group, files)
  files.each do |name|
    ref = group.files.find { |f| f.path == name } || group.new_reference(name)
    target.add_file_references([ref]) unless target.source_build_phase.files_references.include?(ref)
  end
end

shared_group = group_for(project, 'Shared')
shared_attrs = 'StudyTimerAttributes.swift'
shared_group.new_reference(shared_attrs) unless shared_group.files.any? { |f| f.path == shared_attrs }

# --- App target -------------------------------------------------------------
app.build_configurations.each do |c|
  c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET
end
la_group = group_for(project, 'StudyTimer/LiveActivity')
add_sources(app, la_group, %w[
  LiveActivityController.swift ActivityKitClient.swift LiveActivityBridge.swift RCTLiveActivity.mm
])
add_sources(app, shared_group, [shared_attrs])

# --- Widget extension -------------------------------------------------------
widget = project.targets.find { |t| t.name == 'StudyTimerWidget' }
unless widget
  widget = project.new_target(:app_extension, 'StudyTimerWidget', :ios, DEPLOYMENT_TARGET)
  embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
  embed.dst_subfolder_spec = '13' # PlugIns
  build_file = embed.add_file_reference(widget.product_reference, true)
  build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  app.add_dependency(widget)
end
widget.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = "#{BUNDLE_ID}.StudyTimerWidget"
  s['INFOPLIST_FILE'] = 'StudyTimerWidget/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1'
  s['MARKETING_VERSION'] = '1.0'
  s['CURRENT_PROJECT_VERSION'] = '1'
  s['SKIP_INSTALL'] = 'YES'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['ENABLE_PREVIEWS'] = 'YES'
end
widget_group = group_for(project, 'StudyTimerWidget')
widget_group.new_reference('Info.plist') unless widget_group.files.any? { |f| f.path == 'Info.plist' }
add_sources(widget, widget_group, %w[StudyTimerWidgetBundle.swift StudyTimerLiveActivity.swift])
add_sources(widget, shared_group, [shared_attrs])

# --- Unit tests (no host app: they compile the controller directly) ---------
tests = project.targets.find { |t| t.name == 'StudyTimerTests' }
tests ||= project.new_target(:unit_test_bundle, 'StudyTimerTests', :ios, DEPLOYMENT_TARGET)
tests.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = "#{BUNDLE_ID}.tests"
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s.delete('TEST_HOST')
  s.delete('BUNDLE_LOADER')
end
tests_group = group_for(project, 'StudyTimerTests')
add_sources(tests, tests_group, %w[LiveActivityControllerTests.swift])
add_sources(tests, la_group, %w[LiveActivityController.swift])
add_sources(tests, shared_group, [shared_attrs])

project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(tests)
scheme.add_test_target(tests)
scheme.save_as(project.path, 'StudyTimerTests', true)

puts 'Xcode project configured.'
