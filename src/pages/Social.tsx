import { useState } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUsers,
  faCompass,
  faStar,
  faInfoCircle,
  faPlus,
} from "@fortawesome/free-solid-svg-icons";
import { PostCard } from "../components/PostCard";
import { CreatePostModal } from "../components/CreatePostModal";
import "./Social.css";

export const Social = () => {
  usePageTitle();
  const [activeTab, setActiveTab] = useState<'discovery' | 'curated'>('discovery');
  const [isCreatePostModalOpen, setIsCreatePostModalOpen] = useState(false);

  return (
    <div className="social-page">
      <div className="social-header">
        <div className="social-title-section">
          <FontAwesomeIcon icon={faUsers} className="social-icon" />
          <h1>Modulr.Social</h1>
        </div>
        <p className="social-description">
          Connect with the robotics community. Share ideas, discover projects, and stay updated with the latest in robotics development.
        </p>
      </div>

      <div className="social-tabs">
        <button
          className={`social-tab ${activeTab === 'discovery' ? 'active' : ''}`}
          onClick={() => setActiveTab('discovery')}
        >
          <FontAwesomeIcon icon={faCompass} />
          <span>Discovery</span>
        </button>
        <button
          className={`social-tab ${activeTab === 'curated' ? 'active' : ''}`}
          onClick={() => setActiveTab('curated')}
        >
          <FontAwesomeIcon icon={faStar} />
          <span>Curated</span>
        </button>
      </div>

      <div className="social-content">
        {activeTab === 'discovery' ? (
          <div className="social-feed discovery-feed">
            {/* Demo Post 1 - Simple Text-Based */}
            <PostCard
              username="Modulr"
              userBadge="partner"
              content="Welcome to Modulr.Social! 🤖 This is a developer-focused social platform for the robotics community. Share your projects, discuss ideas, and connect with fellow developers working on robots, WebRTC, and teleoperation systems. #robotics #webRTC #developer"
              createdAt={new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()} // 2 hours ago
              likesCount={42}
              commentsCount={12}
              sharesCount={5}
              onUsernameClick={(username) => {
                // Future: Navigate to user profile
                console.log(`Clicked on user: ${username}`);
              }}
            />

            {/* Demo Post 2 - Code Block */}
            <PostCard
              username="dev_engineer"
              userBadge="verified"
              content={`Just finished building a ROS2 robot controller! 🤖

Here's the code I used:

\`\`\`python
import rclpy
from robot_msgs.msg import MovementCommand

def move_forward(distance):
    pub.publish(MovementCommand(x=distance, y=0))
\`\`\`

Works great with #robot-abc123 via #webRTC! Check out @Modulr's platform for more details.

#robotics #ROS2 #python #webRTC`}
              createdAt={new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()} // 5 hours ago
              likesCount={128}
              commentsCount={24}
              sharesCount={8}
              onUsernameClick={(username) => {
                // Future: Navigate to user profile
                console.log(`Clicked on user: ${username}`);
              }}
            />

            {/* Demo Post 3 - Image Gallery (4 images, showing "+X" overlay) */}
            <PostCard
              username="Modulr"
              userBadge="partner"
              content="In Modulr, you can set your robot to these default robot image types until your custom profile image is approved! 🤖 We offer rover, humanoid, drone, submarine, and robot dog options. Perfect for getting started quickly while we review your upload. #robotics #Modulr"
              images={[
                "/default/rover.png",
                "/default/robot.png",
                "/default/drone.png",
                "/default/sub.png",
                "/default/robodog.png",
                "/default/humanoid.png",
              ]}
              createdAt={new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()} // 8 hours ago
              likesCount={89}
              commentsCount={15}
              sharesCount={12}
              onUsernameClick={(username) => {
                // Future: Navigate to user profile
                console.log(`Clicked on user: ${username}`);
              }}
            />

            {/* Demo Post 4 - Inline Code Snippets */}
            <PostCard
              username="ros_dev"
              userBadge="verified"
              content={`Quick tip for ROS2 developers! Use \`ros2 topic list\` to see all available topics, then \`ros2 topic echo /your_topic\` to monitor messages. For teleoperation, I like using \`ros2 run teleop_twist_keyboard teleop_twist_keyboard\` for testing. Works great with #robot-abc123! 🚀

#ROS2 #robotics #teleoperation`}
              createdAt={new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()} // 12 hours ago
              likesCount={156}
              commentsCount={32}
              sharesCount={18}
              onUsernameClick={(username) => {
                // Future: Navigate to user profile
                console.log(`Clicked on user: ${username}`);
              }}
            />

            {/* Demo Post 5 - Poll */}
            <PostCard
              username="Modulr"
              userBadge="partner"
              content={`Polls are a great way to engage with the community! 📊 To create a poll, use markdown syntax with \`- ()\` for each option. Here's an example:

Which robot framework do you prefer for teleoperation?

- () ROS2
- () ROS1
- () Custom WebRTC
- () Other (comment below!)

Vote below! #robotics #polls #community`}
              createdAt={new Date(Date.now() - 15 * 60 * 60 * 1000).toISOString()} // 15 hours ago
              likesCount={203}
              commentsCount={47}
              sharesCount={28}
              onUsernameClick={(username) => {
                // Future: Navigate to user profile
                console.log(`Clicked on user: ${username}`);
              }}
            />

            {/* Demo Post 6 - GIF */}
            <PostCard
              username="robot_lover"
              content="Check out this awesome robot GIF! 🤖 We're using Giphy integration for Phase 1, but later we'll add support for custom GIF uploads to S3. Perfect for sharing quick robot demos and reactions!

#robotics #gifs #fun"
              images={[
                "https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif",
              ]}
              createdAt={new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString()} // 18 hours ago
              likesCount={312}
              commentsCount={68}
              sharesCount={42}
              onUsernameClick={(username) => {
                // Future: Navigate to user profile
                console.log(`Clicked on user: ${username}`);
              }}
            />

            {/* Demo Post 7 - Emoji Test */}
            <PostCard
              username="emoji_master"
              userBadge="verified"
              content={`Emoji test! Let's see how these render: 🤖🦾🦿⚙️🔧⚡🚀🎯📡🔬

Reactions: 👍❤️🔥💯🎉👏🙌😊😎🤔

Tech: 💻⌨️🖥️📱🌐🔌💡🔋📶🎮

Flags: 🇺🇸🇬🇧🇨🇦🇫🇷🇩🇪🇯🇵🇰🇷🇧🇷🇮🇳🇦🇺

General: ✅❌⚠️ℹ️💬📝🔍⭐🌟✨

Testing the US flag 🇺🇸 specifically! Does it render correctly? Let me know! #emojis #testing #flags #robotics`}
              createdAt={new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()} // 20 hours ago
              likesCount={89}
              commentsCount={23}
              sharesCount={15}
              onUsernameClick={(username) => {
                // Future: Navigate to user profile
                console.log(`Clicked on user: ${username}`);
              }}
            />
          </div>
        ) : (
          <div className="social-feed curated-feed">
            <div className="placeholder-content">
              <FontAwesomeIcon icon={faStar} className="placeholder-icon" />
              <h2>Curated Feed</h2>
              <p>
                This will be a personalized feed tuned to your interests, activity, and preferences.
                Content will be algorithmically selected to show you the most relevant robotics content.
              </p>
              <div className="placeholder-info">
                <FontAwesomeIcon icon={faInfoCircle} />
                <span>Coming soon - Personalization algorithm in development</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Action Button - Create Post */}
      <button
        className="social-fab"
        onClick={() => setIsCreatePostModalOpen(true)}
        title="Create a new post"
      >
        <FontAwesomeIcon icon={faPlus} />
      </button>

      {/* Create Post Modal */}
      <CreatePostModal
        isOpen={isCreatePostModalOpen}
        onClose={() => setIsCreatePostModalOpen(false)}
        onSubmit={(content) => {
          console.log('Post submitted:', content);
          // Future: Submit post to backend
          alert(`Post created! (This is a demo - backend integration coming soon)\n\nContent:\n${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
        }}
      />
    </div>
  );
};

