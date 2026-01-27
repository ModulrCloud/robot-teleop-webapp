import { describe, it, expect } from 'vitest';
import {
  isTrustedImageUrl,
  extractHashtags,
  extractMentions,
  extractMarkdownImages,
  extractPoll,
  extractLinkedRobotId,
  determinePostType,
  extractPostMetadata,
} from '../src/utils/postContentExtractor';

describe('isTrustedImageUrl', () => {
  it('accepts Giphy URLs', () => {
    expect(isTrustedImageUrl('https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif')).toBe(true);
    expect(isTrustedImageUrl('https://giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif')).toBe(true);
    expect(isTrustedImageUrl('https://subdomain.giphy.com/media/test.gif')).toBe(true);
  });

  it('accepts Tenor URLs', () => {
    expect(isTrustedImageUrl('https://media.tenor.com/image.gif')).toBe(true);
    expect(isTrustedImageUrl('https://tenor.com/image.gif')).toBe(true);
    expect(isTrustedImageUrl('https://subdomain.tenor.com/image.gif')).toBe(true);
  });

  it('accepts AWS S3 URLs', () => {
    expect(isTrustedImageUrl('https://s3.amazonaws.com/bucket/image.jpg')).toBe(true);
    expect(isTrustedImageUrl('https://bucket.s3.amazonaws.com/image.jpg')).toBe(true);
    expect(isTrustedImageUrl('https://my-bucket.s3.amazonaws.com/image.png')).toBe(true);
  });

  it('rejects untrusted URLs', () => {
    expect(isTrustedImageUrl('https://evil.com/image.jpg')).toBe(false);
    expect(isTrustedImageUrl('https://example.com/image.png')).toBe(false);
    expect(isTrustedImageUrl('http://localhost/image.gif')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isTrustedImageUrl('not-a-url')).toBe(false);
    expect(isTrustedImageUrl('')).toBe(false);
    expect(isTrustedImageUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('extractHashtags', () => {
  it('extracts hashtags from content', () => {
    const content = 'Check out this #robotics post! #webRTC #javascript';
    const hashtags = extractHashtags(content);
    expect(hashtags).toEqual(['robotics', 'webrtc', 'javascript']);
  });

  it('handles robot hashtags', () => {
    const content = 'My robot #robot-abc123 is awesome!';
    const hashtags = extractHashtags(content);
    expect(hashtags).toEqual(['robot-abc123']);
  });

  it('returns unique hashtags', () => {
    const content = '#robotics #robotics #webRTC';
    const hashtags = extractHashtags(content);
    expect(hashtags).toEqual(['robotics', 'webrtc']);
  });

  it('handles hashtags with hyphens', () => {
    const content = '#robot-teleop #web-rtc';
    const hashtags = extractHashtags(content);
    expect(hashtags).toEqual(['robot-teleop', 'web-rtc']);
  });

  it('returns empty array if no hashtags', () => {
    const content = 'Just plain text with no hashtags';
    const hashtags = extractHashtags(content);
    expect(hashtags).toEqual([]);
  });

  it('is case-insensitive', () => {
    const content = '#Robotics #ROBOTICS #robotics';
    const hashtags = extractHashtags(content);
    expect(hashtags).toEqual(['robotics']);
  });
});

describe('extractMentions', () => {
  it('extracts mentions from content', () => {
    const content = 'Hey @johndoe and @janedoe!';
    const mentions = extractMentions(content);
    expect(mentions).toEqual(['johndoe', 'janedoe']);
  });

  it('returns unique mentions', () => {
    const content = '@johndoe @johndoe @janedoe';
    const mentions = extractMentions(content);
    expect(mentions).toEqual(['johndoe', 'janedoe']);
  });

  it('handles mentions with hyphens', () => {
    const content = '@robot-user @test-user';
    const mentions = extractMentions(content);
    expect(mentions).toEqual(['robot-user', 'test-user']);
  });

  it('returns empty array if no mentions', () => {
    const content = 'Just plain text with no mentions';
    const mentions = extractMentions(content);
    expect(mentions).toEqual([]);
  });

  it('is case-insensitive', () => {
    const content = '@JohnDoe @JOHNDOE @johndoe';
    const mentions = extractMentions(content);
    expect(mentions).toEqual(['johndoe']);
  });
});

describe('extractMarkdownImages', () => {
  it('extracts markdown images from trusted sources', () => {
    const content = 'Check out this ![Cool Robot](https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif)';
    const images = extractMarkdownImages(content);
    expect(images).toHaveLength(1);
    expect(images[0].url).toBe('https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif');
    expect(images[0].alt).toBe('Cool Robot');
  });

  it('extracts multiple images', () => {
    const content = `![Image 1](https://s3.amazonaws.com/bucket/image1.jpg)
![Image 2](https://s3.amazonaws.com/bucket/image2.jpg)`;
    const images = extractMarkdownImages(content);
    expect(images).toHaveLength(2);
    expect(images[0].url).toBe('https://s3.amazonaws.com/bucket/image1.jpg');
    expect(images[1].url).toBe('https://s3.amazonaws.com/bucket/image2.jpg');
  });

  it('ignores images from untrusted sources', () => {
    const content = '![Evil](https://evil.com/image.jpg)';
    const images = extractMarkdownImages(content);
    expect(images).toHaveLength(0);
  });

  it('handles images without alt text', () => {
    const content = '![](https://media.giphy.com/media/test.gif)';
    const images = extractMarkdownImages(content);
    expect(images).toHaveLength(1);
    expect(images[0].alt).toBe('');
  });

  it('returns empty array if no images', () => {
    const content = 'Just plain text';
    const images = extractMarkdownImages(content);
    expect(images).toEqual([]);
  });
});

describe('extractPoll', () => {
  it('extracts poll with 2 options', () => {
    const content = `Which framework do you prefer?

- () ROS2
- () ROS1`;
    const poll = extractPoll(content);
    expect(poll).not.toBeNull();
    expect(poll?.options).toEqual(['ROS2', 'ROS1']);
  });

  it('extracts poll with multiple options', () => {
    const content = `What's your favorite language?

- () Python
- () JavaScript
- () Rust
- () Go`;
    const poll = extractPoll(content);
    expect(poll).not.toBeNull();
    expect(poll?.options).toEqual(['Python', 'JavaScript', 'Rust', 'Go']);
  });

  it('returns null if only 1 option', () => {
    const content = `Single option:

- () Only option`;
    const poll = extractPoll(content);
    expect(poll).toBeNull();
  });

  it('returns null if no poll', () => {
    const content = 'Just regular text';
    const poll = extractPoll(content);
    expect(poll).toBeNull();
  });

  it('trims whitespace from options', () => {
    const content = `Poll:

- ()   Option 1  
- ()  Option 2  `;
    const poll = extractPoll(content);
    expect(poll?.options).toEqual(['Option 1', 'Option 2']);
  });
});

describe('extractLinkedRobotId', () => {
  it('extracts robot ID from hashtag', () => {
    const content = 'Check out my robot #robot-abc123!';
    const robotId = extractLinkedRobotId(content);
    expect(robotId).toBe('abc123');
  });

  it('handles multiple hashtags', () => {
    const content = '#robotics #robot-xyz789 #webRTC';
    const robotId = extractLinkedRobotId(content);
    expect(robotId).toBe('xyz789');
  });

  it('returns null if no robot hashtag', () => {
    const content = '#robotics #webRTC #javascript';
    const robotId = extractLinkedRobotId(content);
    expect(robotId).toBeNull();
  });

  it('returns null if hashtag is just "robot"', () => {
    const content = '#robot';
    const robotId = extractLinkedRobotId(content);
    expect(robotId).toBeNull();
  });
});

describe('determinePostType', () => {
  it('returns "poll" if poll exists', () => {
    const content = `Poll question

- () Option 1
- () Option 2`;
    expect(determinePostType(content)).toBe('poll');
  });

  it('returns "gif" if GIF image exists', () => {
    const content = '![GIF](https://media.giphy.com/media/test.gif)';
    expect(determinePostType(content)).toBe('gif');
  });

  it('returns "gif" if Tenor URL exists', () => {
    const content = '![GIF](https://media.tenor.com/image.gif)';
    expect(determinePostType(content)).toBe('gif');
  });

  it('returns "image" if regular image exists', () => {
    const content = '![Image](https://s3.amazonaws.com/bucket/image.jpg)';
    expect(determinePostType(content)).toBe('image');
  });

  it('returns "code" if code block exists', () => {
    const content = `Here's some code:

\`\`\`python
print("Hello")
\`\`\``;
    expect(determinePostType(content)).toBe('code');
  });

  it('returns "text" for plain text', () => {
    const content = 'Just plain text with no special content';
    expect(determinePostType(content)).toBe('text');
  });

  it('prioritizes poll over other types', () => {
    const content = `Poll with code and images

- () Option 1
- () Option 2

\`\`\`python
code here
\`\`\`

![Image](https://s3.amazonaws.com/bucket/image.jpg)`;
    expect(determinePostType(content)).toBe('poll');
  });
});

describe('extractPostMetadata', () => {
  it('extracts all metadata from complex post', () => {
    const content = `Hey @johndoe! Check out my robot #robot-abc123!

![Cool Robot](https://media.giphy.com/media/test.gif)

Which framework do you prefer?

- () ROS2
- () ROS1

#robotics #webRTC`;
    
    const metadata = extractPostMetadata(content);
    
    expect(metadata.hashtags).toContain('robotics');
    expect(metadata.hashtags).toContain('webrtc');
    expect(metadata.hashtags).toContain('robot-abc123');
    expect(metadata.mentions).toContain('johndoe');
    expect(metadata.images).toHaveLength(1);
    expect(metadata.poll).not.toBeNull();
    expect(metadata.poll?.options).toEqual(['ROS2', 'ROS1']);
    expect(metadata.linkedRobotId).toBe('abc123');
    expect(metadata.postType).toBe('poll');
  });

  it('handles post with no special content', () => {
    const content = 'Just plain text';
    const metadata = extractPostMetadata(content);
    
    expect(metadata.hashtags).toEqual([]);
    expect(metadata.mentions).toEqual([]);
    expect(metadata.images).toEqual([]);
    expect(metadata.poll).toBeNull();
    expect(metadata.linkedRobotId).toBeNull();
    expect(metadata.postType).toBe('text');
  });
});
