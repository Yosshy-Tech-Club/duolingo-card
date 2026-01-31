<div align="center">
  <h1>Duolingo Card</h1>
  <h3>Visualize your Duolingo activity as a single SVG</h3>
</div>

---

## Overview

**Duolingo Card** allows you to visualize your Duolingo activity as a **single SVG image**.  
You can embed it in your blog or README to showcase your activity at a glance.

---

## Usage

You can get the SVG using the following URL format:

```
https://duolingo-card.yosshy-123.workers.dev/[user_id]
```

* Replace `[user_id]` with your Duolingo user ID.
* The default theme is light.

### Dark Theme

Add `?theme=dark` to the URL to get a dark-themed SVG:

```
https://duolingo-card.yosshy-123.workers.dev/[user_id]?theme=dark
```

### Super Theme

Add `?theme=super` to the URL to get a dark-themed SVG:

```
https://duolingo-card.yosshy-123.workers.dev/[user_id]?theme=super
```

---

## Example

Light theme:

[![Duolingo Card](https://duolingo-card.yosshy-123.workers.dev/Wojicle)](https://www.duolingo.com/profile/Wojicle)

```markdown
[![Duolingo Card](https://duolingo-card.yosshy-123.workers.dev/Wojicle)](https://www.duolingo.com/profile/Wojicle)
```

Dark theme:

[![Duolingo Card](https://duolingo-card.yosshy-123.workers.dev/Wojicle?theme=dark)](https://www.duolingo.com/profile/Wojicle)

```markdown
[![Duolingo Card](https://duolingo-card.yosshy-123.workers.dev/Wojicle?theme=dark)](https://www.duolingo.com/profile/Wojicle)
```

Super theme:

[![Duolingo Card](https://duolingo-card.yosshy-123.workers.dev/Wojicle?theme=super)](https://www.duolingo.com/profile/Wojicle)

```markdown
[![Duolingo Card](https://duolingo-card.yosshy-123.workers.dev/Wojicle?theme=super)](https://www.duolingo.com/profile/Wojicle)
```
