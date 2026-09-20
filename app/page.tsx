import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'

export default async function Home() {
  const profile = await getCurrentProfile()

  // =========================================================
  // BACKEND / AUTH LOGIC — KEEP
  // =========================================================

  if (profile) {
    if (profile.role === 'applicant') {
      redirect('/book')
    }

    redirect(
      profile.role === 'committee' ||
      profile.role === 'performance_lead'
        ? '/practice'
        : '/head'
    )
  }

  return (
    <main className="home-page">

      {/* =====================================================
          FIXED NAVBAR
          ===================================================== */}

      <header className="home-navbar">
        <div className="navbar-container">

          <Link
            href="/"
            className="navbar-brand"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/vortexalogo.png"
              alt="Vortexa"
              className="navbar-logo"
            />

            <div className="navbar-brand-text">
              <div className="navbar-title">
                26/12 XMUM Foundation Orientation
              </div>
            </div>
          </Link>

          <div className="navbar-right">

            <Link
              href="/login"
              className="committee-button"
            >
              Committee
            </Link>

          </div>
        </div>
      </header>


      {/* =====================================================
          HERO
          ===================================================== */}

      <section className="hero">

        <div className="hero-background" />

        <div className="hero-overlay" />

        <div className="hero-gradient" />


        {/* ===================================================
            HERO CONTENT
            =================================================== */}

        <div className="hero-content">

          <div className="hero-eyebrow">

            <span className="eyebrow-line" />

            26/12 VORTEXA FOUNDATION ORIENTATION 2026

            <span className="eyebrow-line" />

          </div>


          <h1 className="hero-title">

            <span className="hero-title-white">
                <span className="nowrap">Facilitator &</span>{' '}
                <span className="nowrap">Game Master</span>
            </span>

            <span className="hero-title-gradient">
              Interview
            </span>

          </h1>


          <p className="hero-description">
            Click button below to reserve your interview slot.
          </p>


          {/* =================================================
              PRIMARY CTA
              ================================================= */}

          <Link
            href="/book"
            className="book-button"
          >

            <span>
              Reserve Interview Slot
            </span>

            <span className="book-arrow">
              →
            </span>

          </Link>


          {/* =================================================
              CHECK BOOKING
              ================================================= */}

          <Link
            href="/my-booking"
            className="booking-search"
          >

            <span className="search-icon">
              ⌕
            </span>

            <span className="search-placeholder">
              Check your booking slot here
            </span>

            <span className="search-arrow">
              →
            </span>

          </Link>

        </div>


        {/* ===================================================
            SCROLL INDICATOR
            =================================================== */}

        <div className="scroll-indicator">

          <span>
            SCROLL TO EXPLORE
          </span>

          <div className="scroll-line" />

        </div>

      </section>


      {/* =====================================================
          CSS
          ===================================================== */}

      <style>{`

        /* =====================================================
           PAGE
           ===================================================== */

        .home-page {

          position: relative;

          width: 100%;

          min-height: 100vh;

          min-height: 100svh;

          background: #050816;

          color: white;

          overflow-x: hidden;

          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        }


        /* =====================================================
           FIXED NAVBAR
           ===================================================== */

        .home-navbar {

          position: fixed;

          top: 0;
          left: 0;
          right: 0;

          height: 80px;

          z-index: 1000;

          background:
            #063A65;

          backdrop-filter:
            blur(18px);

          -webkit-backdrop-filter:
            blur(18px);

          border-bottom:
            none;

          box-shadow:
            none;
        }


        .navbar-container {

          width:
            min(
              calc(100% - 40px),
              1120px
            );

          height: 100%;

          margin: 0 auto;

          display: flex;

          align-items: center;

          justify-content: space-between;
        }


        /* =====================================================
           NAVBAR BRAND
           ===================================================== */

        .navbar-brand {

          display: flex;

          align-items: center;

          gap: 9px;

          color: white;

          text-decoration: none;
        }


        .navbar-logo {

          width: 72px;

          height: 72px;

          object-fit: contain;

          filter:
            drop-shadow(
              0 0 10px rgba(0,198,255,0.18)
            );

          transition:
            transform 0.3s ease,
            filter 0.3s ease;
        }


        .navbar-brand:hover .navbar-logo {

          transform:
            rotate(-3deg)
            scale(1.06);

          filter:
            drop-shadow(
              0 0 14px rgba(0,198,255,0.35)
            );
        }


        .navbar-brand-text {

          display: flex;

          flex-direction: column;

          justify-content: center;
        }


        .navbar-title {

          color:
            rgba(255,255,255,0.92);

          font-size: 17px;

          font-weight: 700;

          line-height: 1.15;

          white-space: nowrap;
        }


        /* =====================================================
           NAVBAR RIGHT
           ===================================================== */

        .navbar-right {

          display: flex;

          align-items: center;

          gap: 8px;
        }


        .committee-button {

          display: inline-flex;

          align-items: center;

          justify-content: center;

          height: 38px;

          padding:
            0 16px;

          border-radius: 11px;

          border:
            1px solid rgba(255,255,255,0.08);

          background:
            rgba(255,255,255,0.025);

          color:
            rgba(255,255,255,0.9);

          font-size: 13px;

          font-weight: 600;

          text-decoration: none;

          transition:
            background 0.2s ease,
            border-color 0.2s ease,
            box-shadow 0.2s ease,
            transform 0.2s ease;
        }


        .committee-button:hover {

          background:
            rgba(255,255,255,0.08);

          border-color:
            rgba(0,198,255,0.25);

          transform:
            translateY(-1px);
        }


        /* =====================================================
           HERO
           ===================================================== */

        .hero {

          position: relative;

          width: 100%;

          min-height: 100vh;

          min-height: 100svh;

          display: flex;

          align-items: center;

          justify-content: center;

          box-sizing: border-box;

          padding:
            110px 24px 80px;

          overflow: hidden;
        }


        /* =====================================================
           BACKGROUND IMAGE
           ===================================================== */

        .hero-background {

          position: absolute;

          inset: 0;

          z-index: 0;

          background-image:
            url('/campus-bg.jpg');

          background-size: cover;

          background-position: center;

          background-repeat: no-repeat;

          transform:
            scale(1.08);

          animation:
            heroBackgroundZoom
            18s
            ease-out
            forwards;
        }


        @keyframes heroBackgroundZoom {

          from {
            transform:
              scale(1.08);
          }

          to {
            transform:
              scale(1.02);
          }

        }


        /* =====================================================
           DARK IMAGE OVERLAY
           ===================================================== */

        .hero-overlay {

          position: absolute;

          inset: 0;

          z-index: 1;

          background:
            rgba(3, 7, 18, 0.58);
        }


        /* =====================================================
           GRADIENT OVERLAY
           ===================================================== */

        .hero-gradient {

          position: absolute;

          inset: 0;

          z-index: 2;

          background:
            linear-gradient(
              90deg,
              rgba(2,12,25,0.72) 0%,
              rgba(5,8,22,0.40) 45%,
              rgba(27,8,50,0.48) 100%
            );

          pointer-events: none;
        }


        /* =====================================================
           HERO CONTENT
           ===================================================== */

        .hero-content {

          position: relative;

          z-index: 5;

          width:
            min(
              100%,
              900px
            );

          display: flex;

          flex-direction: column;

          align-items: center;

          text-align: center;
        }


        /* =====================================================
           INITIAL ANIMATION STATE
           ===================================================== */

        .hero-eyebrow,
        .hero-title-white,
        .hero-title-gradient,
        .hero-description,
        .book-button,
        .booking-search {

          opacity: 0;
        }


        /* =====================================================
           EYEBROW
           ===================================================== */

        .hero-eyebrow {

          display: flex;

          align-items: center;

          justify-content: center;

          gap: 13px;

          margin-bottom: 20px;

          color:
            rgba(255,255,255,0.70);

          font-size: 10px;

          font-weight: 700;

          letter-spacing: 2px;

          animation:
            heroFadeUp
            0.7s
            ease-out
            0.15s
            forwards;
        }


        .eyebrow-line {

          width: 30px;

          height: 1px;

          background:
            rgba(255,255,255,0.35);

          transform:
            scaleX(0);

          animation:
            eyebrowLineReveal
            0.6s
            ease-out
            0.15s
            forwards;
        }


        @keyframes eyebrowLineReveal {

          from {
            transform:
              scaleX(0);

            opacity: 0;
          }

          to {
            transform:
              scaleX(1);

            opacity: 1;
          }

        }


        /* =====================================================
           BIG TITLE
           ===================================================== */

        .hero-title {

          display: flex;

          flex-direction: column;

          align-items: center;

          margin: 0;

          font-size:
            clamp(
              58px,
              9vw,
              108px
            );

          line-height:
            0.95;

          letter-spacing:
            -0.055em;

          font-weight:
            800;
        }


        /* =====================================================
           FIRST TITLE LINE
           ===================================================== */

        .hero-title-white {

          color:
            #ffffff;

          font-size:
            65px;

          text-shadow:
            0 5px 30px rgba(0,0,0,0.35);

          animation:
            heroTitleReveal
            0.85s
            cubic-bezier(
              0.22,
              1,
              0.36,
              1
            )
            0.30s
            forwards;
        }

        .hero-title-white {
          font-size: 65px;
          ...
        }

        .nowrap {
          white-space: nowrap;
        }


        /* =====================================================
           INTERVIEW
           ===================================================== */

        .hero-title-gradient {

          background:
            linear-gradient(
              20deg,
              #0DFCFD,
              #E0B4FC,
              #FE06AB,
              #FFB1C1
            );

          -webkit-background-clip:
            text;

          background-clip:
            text;

          -webkit-text-fill-color:
            transparent;

          filter:
            drop-shadow(
              0 6px 25px rgba(0,0,0,0.25)
            );

          animation:
            interviewReveal
            0.9s
            cubic-bezier(
              0.22,
              1,
              0.36,
              1
            )
            0.48s
            forwards,
            interviewGlow
            4s
            ease-in-out
            1.5s
            infinite;
        }


        @keyframes heroTitleReveal {

          from {

            opacity: 0;

            transform:
              translateY(35px)
              scale(0.96);

            filter:
              blur(5px);
          }

          to {

            opacity: 1;

            transform:
              translateY(0)
              scale(1);

            filter:
              blur(0);
          }

        }


        @keyframes interviewReveal {

          from {

            opacity: 0;

            transform:
              translateY(40px)
              scale(0.94);

            filter:
              blur(7px);
          }

          to {

            opacity: 1;

            transform:
              translateY(0)
              scale(1);

            filter:
              blur(0);
          }

        }


        @keyframes interviewGlow {

          0%,
          100% {

            filter:
              drop-shadow(
                0 6px 25px
                rgba(0,0,0,0.25)
              );
          }

          50% {

            filter:
              drop-shadow(
                0 6px 28px
                rgba(32,191,255,0.30)
              );
          }

        }


        /* =====================================================
           DESCRIPTION
           ===================================================== */

        .hero-description {

          margin:
            24px 0 0;

          color:
            rgba(255,255,255,0.72);

          font-size:
            16px;

          line-height:
            1.6;

          animation:
            heroFadeUp
            0.7s
            ease-out
            0.72s
            forwards;
        }


        /* =====================================================
           COMMON FADE UP
           ===================================================== */

        @keyframes heroFadeUp {

          from {

            opacity: 0;

            transform:
              translateY(22px);
          }

          to {

            opacity: 1;

            transform:
              translateY(0);
          }

        }


        /* =====================================================
           BOOK BUTTON
           ===================================================== */

        .book-button {

          display: inline-flex;

          align-items: center;

          justify-content: center;

          gap: 20px;

          min-width:
            230px;

          height:
            56px;

          margin-top:
            30px;

          padding:
            0 26px;

          box-sizing:
            border-box;

          border-radius:
            8px;

          background:
            linear-gradient(
              100deg,
              rgba(0, 255, 255, 0.74),
              #a855f7,
              #FE06AB
            );

          color:
            white;

          font-size:
            14px;

          font-weight:
            800;

          text-decoration:
            none;

          box-shadow:
            0 12px 35px
            rgba(168,85,247,0.25);

          animation:
            heroFadeUp
            0.7s
            ease-out
            0.88s
            forwards,
            buttonGlow
            3.5s
            ease-in-out
            1.8s
            infinite;

          transition:
            transform 0.22s ease,
            box-shadow 0.22s ease;
        }


        @keyframes buttonGlow {

          0%,
          100% {

            box-shadow:
              0 12px 35px
              rgba(168,85,247,0.25);
          }

          50% {

            box-shadow:
              0 12px 42px
              rgba(32,191,255,0.38);
          }

        }


        .book-button:hover {

          transform:
            translateY(-3px);

          box-shadow:
            0 16px 40px
            rgba(168,85,247,0.38) !important;
        }


        .book-arrow {

          font-size:
            19px;

          transition:
            transform 0.22s ease;
        }


        .book-button:hover .book-arrow {

          transform:
            translateX(5px);
        }


        /* =====================================================
           CHECK BOOKING
           ===================================================== */

        .booking-search {

          width:
            min(
              100%,
              620px
            );

          height:
            58px;

          margin-top:
            28px;

          padding:
            0 18px;

          box-sizing:
            border-box;

          display:
            flex;

          align-items:
            center;

          gap:
            13px;

          border:
            1.5px solid
            rgba(255,255,255,0.65);

          border-radius:
            12px;

          background:
            rgba(5,8,20,0.28);

          backdrop-filter:
            blur(8px);

          -webkit-backdrop-filter:
            blur(8px);

          color:
            white;

          text-decoration:
            none;

          box-shadow:
            0 8px 30px
            rgba(0,0,0,0.12);

          animation:
            heroFadeUp
            0.7s
            ease-out
            1.02s
            forwards,
            searchPulse
            4s
            ease-in-out
            2s
            infinite;

          transition:
            background 0.22s ease,
            border-color 0.22s ease,
            transform 0.22s ease;
        }


        @keyframes searchPulse {

          0%,
          100% {

            border-color:
              rgba(255,255,255,0.65);
          }

          50% {

            border-color:
              rgba(32,191,255,0.90);
          }

        }


        .booking-search:hover {

          background:
            rgba(5,8,20,0.48);

          border-color:
            rgba(255,255,255,0.9) !important;

          transform:
            translateY(-2px);
        }


        .search-icon {

          width:
            28px;

          display:
            flex;

          justify-content:
            center;

          font-size:
            25px;

          line-height:
            1;

          color:
            rgba(255,255,255,0.85);
        }


        .search-placeholder {

          flex:
            1;

          text-align:
            left;

          color:
            rgba(255,255,255,0.72);

          font-size:
            14px;
        }


        .search-arrow {

          font-size:
            19px;

          color:
            white;

          transition:
            transform 0.22s ease;
        }


        .booking-search:hover .search-arrow {

          transform:
            translateX(5px);
        }


        /* =====================================================
           SCROLL INDICATOR
           ===================================================== */

        .scroll-indicator {

          position:
            absolute;

          z-index:
            5;

          left:
            50%;

          bottom:
            24px;

          transform:
            translateX(-50%);

          display:
            flex;

          align-items:
            center;

          gap:
            12px;

          color:
            rgba(255,255,255,0.40);

          font-size:
            8px;

          font-weight:
            700;

          letter-spacing:
            2px;

          animation:
            scrollIndicatorFloat
            2.8s
            ease-in-out
            infinite;
        }


        @keyframes scrollIndicatorFloat {

          0%,
          100% {

            opacity:
              0.55;

            transform:
              translateX(-50%)
              translateY(0);
          }

          50% {

            opacity:
              1;

            transform:
              translateX(-50%)
              translateY(7px);
          }

        }


        .scroll-line {

          width:
            35px;

          height:
            1px;

          background:
            rgba(255,255,255,0.35);
        }


        /* =====================================================
           TABLET
           ===================================================== */

        @media (max-width: 900px) {

          .hero {

            padding:
              105px 20px 70px;
          }


          .hero-title {

            font-size:
              clamp(
                55px,
                10vw,
                85px
              );
          }


          .booking-search {

            max-width:
              560px;
          }

        }


        /* =====================================================
           MOBILE
           ===================================================== */

        @media (max-width: 640px) {

          .hero {

            min-height:
              100svh;

            padding:
              116px 18px 65px;
          }


          .hero-background {

            background-position:
              center;
          }


          .hero-overlay {

            background:
              rgba(3,7,18,0.67);
          }


          .hero-gradient {

            background:
              linear-gradient(
                180deg,
                rgba(2,12,25,0.60),
                rgba(5,8,22,0.42),
                rgba(15,4,30,0.70)
              );
          }


          .hero-eyebrow {

            gap:
              8px;

            font-size:
              7px;

            letter-spacing:
              1.3px;
          }


          .eyebrow-line {

            width:
              18px;
          }


          .hero-title {

            font-size:
              clamp(
                46px,
                14vw,
                70px
              );

            line-height:
              0.98;
          }


          .hero-title-white {

            font-size:
              clamp(
                42px,
                12vw,
                60px
              );
          }


          .hero-description {

            margin-top:
              18px;

            font-size:
              13px;
          }


          .book-button {

            width:
              min(
                100%,
                310px
              );

            height:
              53px;

            margin-top:
              25px;

            font-size:
              12px;
          }


          .booking-search {

            width:
              min(
                100%,
                350px
              );

            height:
              53px;

            margin-top:
              14px;

            padding:
              0 14px;
          }


          .search-placeholder {

            font-size:
              12px;
          }


          .search-icon {

            font-size:
              22px;
          }


          .scroll-indicator {

            display:
              none;
          }

        }


        /* =====================================================
           SMALL PHONE
           ===================================================== */

        @media (max-width: 380px) {

          .hero-title {

            font-size:
              45px;
          }


          .hero-title-white {

            font-size:
              40px;
          }


          .hero-eyebrow {

            font-size:
              6.5px;
          }

        }


        /* =====================================================
           REDUCED MOTION
           ===================================================== */

        @media (prefers-reduced-motion: reduce) {

          .hero-background,
          .hero-eyebrow,
          .hero-title-white,
          .hero-title-gradient,
          .hero-description,
          .book-button,
          .booking-search,
          .scroll-indicator,
          .eyebrow-line {

            animation:
              none !important;

            opacity:
              1 !important;
          }


          .hero-title-white,
          .hero-title-gradient,
          .hero-description,
          .book-button,
          .booking-search {

            transform:
              none !important;

            filter:
              none !important;
          }

        }

      `}</style>

    </main>
  )
}