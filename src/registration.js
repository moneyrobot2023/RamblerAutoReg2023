import c from 'chalk';
import fs from 'fs';
import Storage from './storage.js';
import Ask from './ask.js';
import Password from './password.js';
import Chrome from './chrome.js';
import log from './log.js';

class Registration {
    constructor(chromePath) {
        this.chromePath = chromePath;

        this.ask = new Ask();
        this.chrome = new Chrome(this.chromePath);
        this.storage = new Storage();

        this.settings = this.storage.loadSettings();
        this.links = this.storage.load('./src/links.json');

        this.selectors = {
            mail: "#login",
            domainButton: ".rui-Select-arrow",
            domainMenu: ".rui-Menu-content",
            pass: "#newPassword",
            passVerify: "#confirmPassword",
            questionType: 'input[placeholder="Выберите вопрос"][tabindex="0"]',
            questionSelect: "div[data-cerber-id*='Почтовый индекс ваших родителей']",
            questionAnswer: "#answer",
            hCapcha: "#checkbox",
            submit: "button[type=submit]",
            submitImapChange: 'button.MailAppsChange-submitButton-S7',
            closePopup: "button.rui-Popup-close"
        };
    }

    async byFile() {
        if(!fs.existsSync(this.settings.mailsFile)) {
            fs.writeFileSync(this.settings.mailsFile, 'mail@rambler.ua:password:recoveryCode');
            log(`${c.cyan(`File ${this.settings.mailsFile} created. Fill it with mail data in the format:`)} ${c.green('mail@rambler.ua:password:recoveryCode')} ${c.cyan('Each mail on a new line. Then restart the program.')}`);
            return;
        }

        log(c.green(`File ${this.settings.mailsFile} found`));

        const imap = await this.ask.askToEnableIMAP();

        const mails = this.storage.parseMailsFile();
        if(!mails || ! mails.length) return;
        log(`Loaded ${mails.length} mails`);

        const toStart = await this.ask.askToStartRegistration();
        if(!toStart) return;

        this.regMails(mails, 'move', imap);
    }

    async byGenerate() {
        let answers = await this.ask.ask();
        let login = answers.mailLogin;
        let domain = answers.domain;
        let pass = answers.mailPassword;
        let passLength = +answers.passLength;
        let emailsCount = +answers.emailsCount;
        let code = answers.code;
        let startValue = 1;

        if(emailsCount > 1) {
            startValue = await this.ask.askMailStartValue(login);
        }
    
        if(passLength == 0) {
            passLength = 15;
        }
    
        if(emailsCount == 0) {
            emailsCount = 1;
        }
    
        if(startValue == 0) {
            startValue = 1;
        }

        const imap = await this.ask.askToEnableIMAP();
    
        const mails = await this.generateAccounts(login, domain, pass, passLength, emailsCount, startValue, code);
        const toStart = await this.ask.askToStartRegistration();
        if(!toStart) return;

        this.regMails(mails, 'add', imap);
    }

    async regMails(mails, toFile, imap = false) {
        let registered = 0;
        await this.chrome.launch();

        for(let i = 0; i < mails.length; i++) {
            const mail = mails[i];

            log(c.cyan(`[${(i + 1)}] Registering ${mail.login}...`));
            const res = await this.reg(mail.login, mail.domain, mail.pass, mail.code, imap);
        
            if(res) {
                log(`${c.green(`[${(i + 1)}] Mail`)} ${c.magenta(mail.email)} ${c.green(`successfully registered:`)}`);
                log(mail.email);
                log(mail.pass);

                if(toFile == 'move') {
                    await this.storage.moveMailToRegisteredFile(mail.email);
                }

                if(toFile == 'add') {
                    await this.storage.addMailToRegisteredFile(mail);
                }
                registered++;
            } else {
                log(c.red(`Failed to register mail ${mail.email}`));
                const toContinue = await this.ask.askToContinue();

                if(!toContinue) break;
            }
        }
        
        await this.chrome.close();
        log(c.green(`Successfully registered ${c.yellowBright(registered)} accounts.`));
    }

    async reg(login, domain, pass, code, imap) {
        let result = false;
    
        try {
            const browser = this.chrome.getBrowser();
            const pages = await browser.pages();
            const page = pages[0];
            await page.goto(this.links.url);
    
            await page.waitForSelector(this.selectors.mail);
            await page.type(this.selectors.mail, login, {delay: 20});

            await page.evaluate(() => {
                return new Promise((resolve, reject) => {
                    document.querySelector('.rui-Select-arrow').click();
                    resolve(true);
                });
            });

            await page.waitForSelector(this.selectors.domainMenu);
            await page.evaluate((domainId) => {
                return new Promise((resolve, reject) => {
                    document.querySelector('.rui-Menu-content').children[domainId].click();
                    resolve(true);
                });
            }, this.getDomainNumber(domain));
    
            await page.type(this.selectors.pass, pass, {delay: 20});
    
            await page.type(this.selectors.passVerify, pass, {delay: 20});
    
            await page.click(this.selectors.questionType);
    
            await page.waitForSelector(this.selectors.questionSelect);
            await this.sleep(100);
            await page.click(this.selectors.questionSelect);
    
            await page.type(this.selectors.questionAnswer, code, {delay: 20});
            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');

            const iframeHandle = await page.$('iframe');
            const iframe = await iframeHandle.contentFrame();

            await iframe.evaluate(() => {
                return new Promise((resolve, reject) => {
                    const checkbox = document.querySelector('div#checkbox');
                    checkbox.click();
                    resolve();
                });
            });
    
            await page.evaluate(() => {
                return new Promise((resolve, reject) => {
                    setInterval(() => {
                        const element = document.querySelector('iframe');
                        const capchaResp = element.dataset.hcaptchaResponse;
                        console.log(capchaResp);
                        if(!capchaResp || capchaResp == "") return;
                        resolve(capchaResp);
                    }, 200);
                });
            });
            
            await page.click(this.selectors.submit);
            
            while(!(await page.target()._targetInfo.url).includes(this.links.readyPage)) {
                await this.sleep(500);
            }

            if(imap) {
                await page.goto('https://mail.rambler.ru/settings/mailapps/change');
                await page.waitForSelector(this.selectors.submitImapChange);

                await page.evaluate((closePopup) => {
                    return new Promise((resolve, reject) => {
                        let elements = [];

                        while (!elements || elements.length < 2) {
                            elements = document.querySelectorAll(closePopup);

                        }

                        const lastElement = elements[elements.length - 1];
                        lastElement.click();
                        resolve();
                    });
                }, this.selectors.closePopup);

                await page.goto('https://mail.rambler.ru/settings/mailapps/change');
                await page.waitForSelector(this.selectors.submitImapChange);

                await page.evaluate((submitImapChange) => {
                    return new Promise((resolve, reject) => {
                        setInterval(() => {
                            const element = document.querySelector(submitImapChange);
                            console.log(element.disabled);
                            if(!element || element.disabled == true) return;
                            resolve();
                        }, 200);
                    });
                }, this.selectors.submitImapChange);

                await page.click(this.selectors.submitImapChange);
            }

            await this.chrome.deleteCookies(page);
    
            result = {
                login: `${login}@${domain}`,
                pass: pass,
                code: code
            };
        } catch (err) {
            log(c.red(`Error while registering mail: ${err}`));
        }
    
        return result;
    }

    generateAccounts(login, domain, pass, passLength, emailsCount, startValue, code) {
        let accounts = [];
        let password = new Password();
    
        for(let i = startValue; i < emailsCount + startValue; i++) {
            let currentLogin = login;
            let currentPass = pass;

            if(emailsCount != 1) {
                currentLogin = `${login}${i}`;
                currentPass = `${pass}${i}`;
            }
    
            const email = `${currentLogin}@${domain}`;
            if (!currentPass || currentPass == "")
                currentPass = password.generate(passLength);
    
            accounts[accounts.length] = {
                login: currentLogin,
                domain: domain,
                email: email,
                pass: currentPass,
                code: code
            };
        }

        return accounts;
    }

    async sleep(timeout) {
        return new Promise((resolve) => {
            setTimeout(resolve, timeout);
        });
    }

    getDomainNumber(domain) {
        switch(domain) {
            case 'autorambler.ru': return 0;
            case 'myrambler.ru': return 1;
            case 'rambler.ru': return 2;
            case 'rambler.ua': return 3;
            case 'ro.ru': return 4;
            default: return 2;
        }
    }
}

export default Registration;