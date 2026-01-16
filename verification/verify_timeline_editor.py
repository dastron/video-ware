import json
import os
from playwright.sync_api import sync_playwright, Page, expect

def test_timeline_editor(page: Page):
    # Debug: Print console logs
    page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))
    page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))
    # page.on("request", lambda req: print(f"REQ: {req.url}"))

    def handle_json(route, data):
        print(f"MOCKING: {route.request.url}")
        route.fulfill(status=200, content_type="application/json", body=json.dumps(data))

    # User Auth Refresh
    page.route("**/api/collections/users/auth-refresh", lambda route: handle_json(route, {
        "record": {"id": "user1", "email": "test@test.com"},
        "token": "test-token"
    }))

    # Workspace
    page.route("**/api/collections/Workspaces/records**", lambda route: handle_json(route, {
        "items": [{"id": "ws1", "name": "Test Workspace", "members": ["user1"]}]
    }))

    # Timeline
    timeline_data = {
        "id": "tl1",
        "name": "Test Timeline",
        "WorkspaceRef": "ws1",
        "clips": [],
        "duration": 100,
        "expand": {
             "TimelineClips_via_TimelineRef": []
        }
    }
    # Match both simple get and with query params
    page.route("**/api/collections/Timelines/records/tl1*", lambda route: handle_json(route, timeline_data))

    # Media Clips
    page.route("**/api/collections/MediaClips/records**", lambda route: handle_json(route, {
        "items": [],
        "totalItems": 0
    }))

    # Recommendations
    page.route("**/api/collections/TimelineRecommendations/records**", lambda route: handle_json(route, {
        "items": [],
        "totalItems": 0
    }))

    # Files (Proxy/Thumbnail) - Mock 404 or simple image to avoid errors
    page.route("**/api/files/**", lambda route: route.fulfill(status=404))

    # 1. Navigate
    print("Navigating...")
    page.goto("http://localhost:3000/timelines/tl1")

    # 2. Inject Auth
    print("Injecting auth...")
    page.evaluate("""() => {
        const authStore = {
            token: "test-token",
            model: { id: "user1", email: "test@test.com" }
        };
        localStorage.setItem("pocketbase_auth", JSON.stringify(authStore));
        // Also set a cookie if server components check it, but this is client verification mainly.
        document.cookie = "pb_auth=" + JSON.stringify(authStore) + "; path=/";
    }""")

    # 3. Reload
    print("Reloading...")
    page.reload()

    # 4. Wait for content
    print("Waiting for content...")
    try:
        expect(page.get_by_text("Test Timeline")).to_be_visible(timeout=10000)
    except:
        print("Timeout. Taking screenshot...")
        page.screenshot(path="verification/timeout.png")
        raise

    print("Timeline loaded.")

    # 5. Check ClipBrowser Sort
    page.click("text=Recent")
    expect(page.get_by_role("option", name="Creation Time")).to_be_visible()
    print("Creation Time option found.")
    page.keyboard.press("Escape")

    # 6. Check Settings
    settings_btn = page.get_by_title("Settings")
    expect(settings_btn).to_be_visible()
    print("Settings button found.")
    settings_btn.click()

    expect(page.get_by_text("Recommendation Settings")).to_be_visible()
    expect(page.get_by_text("Active Strategies")).to_be_visible()
    print("Settings modal opened.")

    # 7. Screenshot
    page.screenshot(path="verification/verification.png")
    print("Screenshot taken.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_timeline_editor(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
