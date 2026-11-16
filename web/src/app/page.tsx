import Link from "next/link";
import { Snow, TopBar, GoogleButton } from "@/components/ui";
import { Wheel } from "@/components/Wheel";

const demoNames = ["Anjali", "Rahul", "Fathima", "Meera", "Vishnu", "Sneha", "Kiran", "Divya", "Joel", "Nisha"];

export default function Landing() {
  return (
    <>
      <Snow />
      <main className="page">
        <TopBar nav={[{ href: "/login", label: "Sign in" }]} />

        <section className="hero">
          <div>
            <span className="kicker">Office gift exchange, sorted</span>
            <h1>
              Spin the wheel.
              <br />
              <em>Keep the secret.</em>
            </h1>
            <p>
              Add your team, everyone signs in with Google, writes a wishlist and spins once to find who they are
              gifting. No spreadsheets, no paper slips, no peeking.
            </p>
            <div className="hero-cta">
              <GoogleButton href="/login" label="Get started with Google" />
              <Link href="/login?as=admin" className="link-btn">
                Set up for my company
              </Link>
            </div>
          </div>
          <div className="hero-art">
            <Wheel
              names={demoNames}
              idle
              hub={
                <span className="hub" aria-hidden="true">
                  🎅
                </span>
              }
            />
          </div>
        </section>

        <ol className="how" aria-label="How it works">
          <li className="card card-dark">
            <div className="num">1</div>
            <h3>Admin adds the team</h3>
            <p>Create your company space, then add staff one by one or upload a CSV.</p>
          </li>
          <li className="card card-dark">
            <div className="num">2</div>
            <h3>Everyone makes a wishlist</h3>
            <p>Staff sign in with their work Google account and list a few gifts they would love.</p>
          </li>
          <li className="card card-dark">
            <div className="num">3</div>
            <h3>One spin each</h3>
            <p>The wheel lands on your giftee and shows their wishlist. Nobody else sees it.</p>
          </li>
        </ol>

        <div className="trust">
          <span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
            </svg>
            Google sign-in, no passwords stored
          </span>
          <span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Results encrypted, hidden even from admins
          </span>
          <span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Nobody draws themselves
          </span>
        </div>
      </main>
    </>
  );
}
