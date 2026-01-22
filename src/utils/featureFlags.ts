/**
 * Feature flags stored in localStorage for development features.
 * 
 * Enable a feature in browser console:
 *   localStorage.setItem('feature_custom_ros_commands', 'true')
 * 
 * Disable a feature:
 *   localStorage.removeItem('feature_custom_ros_commands')
 */

const FEATURE_FLAGS = {
    CUSTOM_ROS_COMMANDS: 'feature_custom_ros_commands',
} as const;

export function isFeatureEnabled(flag: keyof typeof FEATURE_FLAGS): boolean {
    try {
        return localStorage.getItem(FEATURE_FLAGS[flag]) === 'true';
    } catch {
        return false;
    }
}

export { FEATURE_FLAGS };
