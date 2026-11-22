# How to edit your portfolio

You never need to touch any code. Every word and picture on the website lives in two places:

| What you want to change | Where |
|---|---|
| Any text on the website | The files in the **`content`** folder |
| Your photo | **`public/images/portrait`** |
| Project screenshots | **`public/images/projects`** |
| Certificate pictures | **`public/images/certificates`** |

Changing one entry only changes that one thing. Everything else on the site stays exactly as it is.

---

## 1. See the website on your computer

Double-click **`start-website.bat`** in the main folder. A black window opens and your browser shows the site.

- Keep the black window open while you look at the site. Close it to stop.
- While it runs, every time you save a file the browser updates by itself within a second or two.
- If the browser doesn't open on its own, go to **http://localhost:5174**.

---

## 2. Which file controls what

| File in `content` | What it controls on the website |
|---|---|
| `site.json` | Browser tab title, the menu at the top, and small labels such as "Project preview" or "View credential" |
| `home.json` | "Welcome, I'm", your name, and your photo |
| `about.json` | Section 02: the big sentence and the paragraph under it |
| `skills.json` | Section 03: every skill, its description and its list of tools |
| `projects.json` | Section 04: every project, its description, technologies, screenshot and links |
| `certificates.json` | Section 05: every certificate, its issuer, date, picture and link |
| `contact.json` | Section 06: the big "Let's create" words, your email, GitHub and LinkedIn |
| `footer.json` | The thin strip at the very bottom: copyright, sign-off line and "Back to top" button |

Open them with **Notepad** (right-click → Open with → Notepad) or, better, **VS Code**, which highlights mistakes in red.

---

## 3. The one rule when editing text

Only change what is **inside the quotes on the right side**. Leave everything else alone.

```
"name": "Narahari Lenka",
         ↑ change this part only ↑
```

- Keep both quote marks `"` around your text.
- Keep the commas at the ends of lines exactly where they are.
- If your text itself needs a quote mark, use the curly one (’ or “ ”) instead of `"`.
- To leave something empty, use two quotes with nothing between them: `""`. Empty links are hidden automatically.
- The `_help` line at the top of each file is just a note for you; the website ignores it.

---

## 4. Changing pictures

**Your photo**
1. Copy your photo into `public/images/portrait`.
2. In `content/home.json`, type its file name: `"portraitImage": "my-photo.jpg",`

**A project screenshot**
1. Copy the screenshot into `public/images/projects`.
2. In `content/projects.json`, find that project and type the file name: `"image": "retinax.png",`

**A certificate picture**
1. Copy the picture into `public/images/certificates`.
2. In `content/certificates.json`, find that certificate and type the file name: `"image": "python-certificate.jpg",`

Tips:
- Type the file name **exactly**, including the ending (`.jpg`, `.png`, `.webp`) and capital letters.
- Any size or shape works. Project screenshots and certificates adjust their frame automatically; certificates are never cropped.
- Smaller files load faster: aim for under about 1 MB per image.

---

## 5. Adding or removing projects, skills or certificates

Each project, skill or certificate is one block that starts with `{` and ends with `}`.

**To add one:** copy a whole block, from `{` to `}`, paste it after the last block, put a comma between the two blocks, then change the text.

```
"projects": [
  { "title": "First project", ... },
  { "title": "Second project", ... }     ← no comma after the very last one
]
```

**To remove one:** delete its whole block from `{` to `}`, and delete the comma that separated it from its neighbour.

Project numbers (01, 02, 03…) update themselves, and the Skills section adjusts its length to however many skills you have.

---

## 6. If something goes wrong

You can't break the website by mistake. If a file has a typing error, the site keeps showing the last version that worked, and a **red bar** appears at the top of the page naming the file and the line, for example:

> content/about.json (line 5): there is a typing mistake near here…

The mistake is on that line or the line just above it. The usual causes:

- A missing or extra comma
- A missing quote mark `"`
- A missing `{`, `}`, `[` or `]`

Fix it and save; the red bar disappears by itself. If you can't find it, press **Ctrl + Z** in the editor to undo your last changes, then save.

---

## 7. Good to know

- **Very long text** wraps onto more lines, but it won't break the layout. Short, punchy text still looks best, especially for titles and your name.
- **Colours, animations and the background** are deliberately not in these files, so editing content can never change the design.
- **Putting the site online:** when you're happy with your changes, run `npm run build`. The finished website appears in the `dist` folder, ready to upload to a host such as Netlify or Vercel.
