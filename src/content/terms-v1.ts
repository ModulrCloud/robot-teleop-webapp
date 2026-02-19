/**
 * Terms of Service – single source of truth (Markdown).
 * Edit TERMS_CONTENT_MARKDOWN when changing terms; bump termsVersion in PlatformSettings (or Admin).
 * HTML is derived via marked for display.
 */

import { marked } from "marked";

export const TERMS_VERSION_DEFAULT = "1.0";
export const TERMS_LAST_UPDATED_DEFAULT = "2025-02-18";

export const TERMS_TITLE = "Terms of Service";

/** Single source of truth for default TOS body. Used for display (as HTML) and for admin when no custom content is in DB. */
export const TERMS_CONTENT_MARKDOWN = `## 1. Acceptance
By accessing or using the Modulr platform ("Service"), you agree to these Terms of Service ("Terms"). If you do not agree, do not use the Service.

## 2. Description of Service
Modulr provides a teleoperation platform that connects users with robots and related services. Use of the Service may involve credits, subscriptions, or other fees as described in the Service.

## 3. Eligibility
You must be at least 18 years old and able to form a binding contract. You may not use the Service if you are prohibited by applicable law or if your account has been suspended or terminated.

## 4. Account and Security
You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. You must provide accurate information and notify us of any unauthorized use.

## 5. Acceptable Use
You agree to use the Service only for lawful purposes and in accordance with these Terms. You may not: (a) misuse or abuse the Service or any robots or systems you access; (b) attempt to gain unauthorized access to any systems or data; (c) use the Service in any way that could harm, disable, or impair the Service or others; or (d) violate any applicable laws or regulations.

## 6. Fees and Credits
Use of the Service may require credits or other payment. Fees, credit packages, and payment terms are described in the Service. We may change pricing with notice where required. Refunds are subject to our policies.

## 7. Intellectual Property
The Service, including its design, features, and content we provide, is owned by Modulr or its licensors. You receive a limited license to use the Service in accordance with these Terms. You retain ownership of your data; you grant us the rights necessary to operate and provide the Service.

## 8. Privacy
Your use of the Service is subject to our Privacy Policy. By using the Service, you consent to the collection and use of information as described there.

## 9. Disclaimers
The Service is provided "as is" and "as available." We disclaim all warranties, express or implied, including merchantability and fitness for a particular purpose. We do not guarantee uninterrupted or error-free operation.

## 10. Limitation of Liability
To the maximum extent permitted by law, Modulr and its affiliates shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or data, arising from your use of the Service.

## 11. Termination
We may suspend or terminate your access to the Service at any time for violation of these Terms or for any other reason. You may stop using the Service at any time. Provisions that by their nature should survive will survive termination.

## 12. Changes to Terms
We may update these Terms from time to time. The current version is always available at the Terms of Service page within the app. Continued use of the Service after changes constitutes acceptance of the updated Terms. For material changes, we may require you to accept the new Terms before continued use.

## 13. General
These Terms constitute the entire agreement between you and Modulr regarding the Service. If any provision is found unenforceable, the remaining provisions remain in effect. Our failure to enforce any right does not waive that right.

## Contact
For questions about these Terms, contact us through the contact information provided in the Service or on our website.
`.trim();

/** HTML derived from TERMS_CONTENT_MARKDOWN for display (modal, /terms page) when no DB content is set. */
export const TERMS_CONTENT = marked.parse(TERMS_CONTENT_MARKDOWN, { async: false }) as string;
