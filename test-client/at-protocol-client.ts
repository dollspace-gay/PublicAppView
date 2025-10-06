#!/usr/bin/env tsx
import { BskyAgent } from "@atproto/api";

const APPVIEW_URL = process.env.APPVIEW_URL || "http://localhost:5000";
const VERBOSE = process.env.VERBOSE === "true";

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  data?: any;
}

class AppViewTester {
  private agent: BskyAgent;
  private results: TestResult[] = [];

  constructor(serviceUrl: string) {
    this.agent = new BskyAgent({ service: serviceUrl });
    console.log(`[DEBUG] BskyAgent initialized with service: ${serviceUrl}`);
  }

  private logResult(result: TestResult) {
    this.results.push(result);
    const icon = result.passed ? "✓" : "✗";
    const color = result.passed ? "\x1b[32m" : "\x1b[31m";
    console.log(`${color}${icon}\x1b[0m ${result.name}: ${result.message}`);
    if (result.data) {
      console.log(`  Data:`, JSON.stringify(result.data, null, 2).split("\n").slice(0, 10).join("\n"));
    }
  }

  async testActorSearch(query: string): Promise<void> {
    console.log(`\n[TEST] Searching for actors: "${query}"`);
    try {
      const response = await this.agent.api.app.bsky.actor.searchActors({ q: query, limit: 5 });
      
      if (VERBOSE) {
        console.log("[DEBUG] Response:", JSON.stringify(response, null, 2));
      }
      
      if (!response.data.actors) {
        this.logResult({
          name: "Actor Search Structure",
          passed: false,
          message: "Response missing 'actors' field"
        });
        return;
      }

      this.logResult({
        name: "Actor Search Structure",
        passed: true,
        message: `Found ${response.data.actors.length} actors`
      });

      if (response.data.actors.length > 0) {
        const firstActor = response.data.actors[0];
        const hasRequiredFields = !!(firstActor.did && firstActor.handle);
        
        this.logResult({
          name: "Actor Data Fields",
          passed: hasRequiredFields,
          message: hasRequiredFields 
            ? `Actor has DID and handle: ${firstActor.handle}`
            : "Actor missing required fields (did/handle)",
          data: firstActor
        });
      } else {
        this.logResult({
          name: "Actor Search Results",
          passed: false,
          message: `No results found for query "${query}"`
        });
      }
    } catch (error: any) {
      console.error("[ERROR] Actor search failed:", error);
      if (error.cause) console.error("[ERROR] Cause:", error.cause);
      this.logResult({
        name: "Actor Search",
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  async testGetProfile(identifier: string): Promise<void> {
    console.log(`\n[TEST] Getting profile: ${identifier}`);
    try {
      const response = await this.agent.api.app.bsky.actor.getProfile({ actor: identifier });
      
      const hasRequiredFields = !!(response.data.did && response.data.handle);
      
      this.logResult({
        name: "Get Profile",
        passed: hasRequiredFields,
        message: hasRequiredFields
          ? `Profile fetched: ${response.data.handle} (${response.data.displayName || "no display name"})`
          : "Profile missing required fields",
        data: {
          did: response.data.did,
          handle: response.data.handle,
          displayName: response.data.displayName,
          followersCount: response.data.followersCount,
          followsCount: response.data.followsCount,
          postsCount: response.data.postsCount
        }
      });
    } catch (error: any) {
      console.error("[ERROR] Get profile failed:", error);
      if (error.validationError) console.error("[ERROR] Validation:", error.validationError.message);
      if (error.responseBody) console.error("[ERROR] Response body:", JSON.stringify(error.responseBody, null, 2));
      this.logResult({
        name: "Get Profile",
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  async testGetTimeline(limit: number = 10): Promise<void> {
    console.log(`\n[TEST] Getting timeline (limit: ${limit})`);
    try {
      const response = await this.agent.api.app.bsky.feed.getTimeline({ limit });
      
      if (!response.data.feed) {
        this.logResult({
          name: "Timeline Structure",
          passed: false,
          message: "Response missing 'feed' field"
        });
        return;
      }

      this.logResult({
        name: "Timeline Structure",
        passed: true,
        message: `Fetched ${response.data.feed.length} posts`
      });

      if (response.data.feed.length > 0) {
        const firstPost = response.data.feed[0];
        const hasRequiredFields = !!(firstPost.post && firstPost.post.uri && firstPost.post.author);
        
        this.logResult({
          name: "Timeline Post Structure",
          passed: hasRequiredFields,
          message: hasRequiredFields
            ? `Post from ${firstPost.post.author.handle}`
            : "Post missing required fields",
          data: {
            uri: firstPost.post.uri,
            author: firstPost.post.author.handle,
            text: (firstPost.post.record as any)?.text?.substring(0, 100)
          }
        });
      }
    } catch (error: any) {
      this.logResult({
        name: "Get Timeline",
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  async testGetAuthorFeed(actor: string, limit: number = 10): Promise<void> {
    console.log(`\n[TEST] Getting author feed: ${actor} (limit: ${limit})`);
    try {
      const response = await this.agent.api.app.bsky.feed.getAuthorFeed({ actor, limit });
      
      if (!response.data.feed) {
        this.logResult({
          name: "Author Feed Structure",
          passed: false,
          message: "Response missing 'feed' field"
        });
        return;
      }

      this.logResult({
        name: "Author Feed Structure",
        passed: true,
        message: `Fetched ${response.data.feed.length} posts from ${actor}`
      });

      if (response.data.feed.length > 0) {
        const firstPost = response.data.feed[0];
        const hasRequiredFields = !!(firstPost.post && firstPost.post.uri && firstPost.post.author);
        
        this.logResult({
          name: "Author Feed Post Structure",
          passed: hasRequiredFields,
          message: hasRequiredFields
            ? `Post: ${(firstPost.post.record as any)?.text?.substring(0, 50) || 'No text'}...`
            : "Post missing required fields"
        });
      }
    } catch (error: any) {
      this.logResult({
        name: "Get Author Feed",
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  printSummary(): void {
    console.log("\n" + "=".repeat(60));
    console.log("TEST SUMMARY");
    console.log("=".repeat(60));
    
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;
    
    console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
    console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
    
    if (failed > 0) {
      console.log("\nFailed Tests:");
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.message}`);
      });
    }
    
    console.log("=".repeat(60));
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("AT Protocol AppView Client Test");
  console.log(`Testing: ${APPVIEW_URL}`);
  console.log("=".repeat(60));

  const tester = new AppViewTester(APPVIEW_URL);

  // Test 1: Actor search with various queries
  await tester.testActorSearch("kawanishi");
  await tester.testActorSearch("bsky");
  await tester.testActorSearch("alice");

  // Test 2: Get a specific profile (if we found one from search)
  // Using a known handle from our database
  await tester.testGetProfile("kawanishitakumi.bsky.social");
  
  // Test 3: Get timeline (reverse chronological feed)
  await tester.testGetTimeline(10);

  // Test 4: Get author feed
  await tester.testGetAuthorFeed("kawanishitakumi.bsky.social", 5);

  // Print summary
  tester.printSummary();
}

main().catch(console.error);
