/** Admin → Media: the media bucket (portrait, projects, certificates). */
import MediaBrowser from './MediaBrowser'

export default function MediaLibrary() {
  return (
    <div className="adm-editor">
      <header className="adm-editor__head">
        <h1 id="adm-section-title" className="adm-title">
          Media
        </h1>
        <div className="adm-text">
          Images and PDFs in the portfolio-media bucket. Uploading doesn’t change the site: a file appears only once content uses it and that content is published.
        </div>
      </header>
      <MediaBrowser mode="library" />
    </div>
  )
}
