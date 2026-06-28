import type { Page } from 'playwright-core'
import { CarrierScraper } from './base'
import type { RosterRow } from './base'

export class UHCScraper extends CarrierScraper {
  carrier = 'uhc'
  loginUrl = 'https://www.uhcprovider.com/en/producer-resources.html'

  async doLogin(page: Page, username: string, password: string): Promise<boolean> {
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' })
    await this.humanDelay()

    try {
      await page.waitForSelector('#userNameInput, input[name="username"], input[type="email"]', { timeout: 10000 })
      await page.fill('#userNameInput, input[name="username"], input[type="email"]', username)
      await this.humanDelay(500, 1200)

      await page.fill('#passwordInput, input[name="password"], input[type="password"]', password)
      await this.humanDelay(800, 1500)

      await page.click('#submitButton, button[type="submit"], input[type="submit"]')
      await page.waitForNavigation({ timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {})
      await this.humanDelay(1000, 2000)

      // Check for MFA prompt
      const mfaVisible = await page.$('#otpField, input[name="otp"], [data-mfa], #verificationCode').catch(() => null)
      if (mfaVisible) return false

      // Check for login error
      const errVisible = await page.$('.error-message, .login-error, [aria-live="assertive"]').catch(() => null)
      if (errVisible) return false

      return true
    } catch {
      return false
    }
  }

  async downloadRoster(page: Page): Promise<RosterRow[]> {
    // Navigate to member/subscriber roster section
    await page.goto('https://www.uhcprovider.com/producer/members', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await this.humanDelay(1500, 3000)

    const exportBtn = await page.$(
      '[data-export], [aria-label*="export" i], [aria-label*="download" i], button:has-text("Export"), a:has-text("Download Roster")'
    ).catch(() => null)

    if (exportBtn) {
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 15000 }),
          exportBtn.click(),
        ])
        const path = await download.path()
        if (path) {
          const { readFileSync } = await import('fs')
          const { parseRosterFile } = await import('@/lib/churn/roster-parser')
          const buffer = readFileSync(path).buffer
          return parseRosterFile(buffer, 'uhc')
        }
      } catch {
        // Fall through to table scrape
      }
    }

    return this.scrapeTable(page)
  }
}
