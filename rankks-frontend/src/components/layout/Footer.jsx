import './Footer.css'
import { FaFacebookF, FaXTwitter, FaInstagram, FaTiktok } from 'react-icons/fa6'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-top">

        <div className="footer-col">
          <div className="footer-title">Football</div>
          <ul>
            <li className="footer-links">Premier League</li>
            <li className="footer-links">Liga</li>
            <li className="footer-links">Seria A</li>
            <li className="footer-links">Bundesliga</li>
            <li className="footer-links">Ligue 1</li>
            <li className="footer-links">Champions League</li>
            <li className="footer-links">World Cup</li>
          </ul>
        </div>

        <div className="footer-col">
          <div className="footer-title">Topics</div>
          <ul>
            <li className="footer-links">ATP</li>
            <li className="footer-links">WTA</li>
            <li className="footer-links">NBA</li>
            <li className="footer-links">PGA</li>
            <li className="footer-links">F1</li>
            <li className="footer-links">MotoGP</li>
            <li className="footer-links">PDC</li>
          </ul>
        </div>

        <div className="footer-col">
          <div className="footer-title">Rankks</div>
          <ul>
            <li className="footer-links">About Us</li>
            <li className="footer-links">FAQ</li>
            <li className="footer-links">Contact Us</li>
            <li className="footer-links">Work with Us</li>
          </ul>
        </div>

        <div className="footer-col">
          <div className="footer-title">Follow Rankks</div>
          <ul>
            <li className="footer-links footer-social"><FaFacebookF /> Facebook</li>
            <li className="footer-links footer-social"><FaXTwitter /> X</li>
            <li className="footer-links footer-social"><FaInstagram /> Instagram</li>
            <li className="footer-links footer-social"><FaTiktok /> TikTok</li>
          </ul>
        </div>

      </div>

      <div className="footer-bottom">
        <span className="footer-text">© RANKKS 2026</span>
        <div className="footer-legal">
          <span className="footer-text">Terms of use</span>
          <span className="footer-sep">|</span>
          <span className="footer-text">Privacy Policy</span>
          <span className="footer-sep">|</span>
          <span className="footer-text">Cookie Policy</span>
        </div>
        <img src="/media/logos/rankks-logo.png" alt="RANKKS" className="footer-logo-badge" />
      </div>
    </footer>
  )
}
